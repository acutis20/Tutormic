/**
 * Grava a aula em segmentos independentes (cada um é um arquivo completo e tocável).
 * O MediaRecorder é reiniciado a cada `segmentMs`: assim nenhum arquivo passa do limite
 * de 25 MB do Whisper e, se o celular desligar, perde-se no máximo o segmento atual.
 */
export interface RecordedSegment {
  idx: number;
  blob: Blob;
  mimeType: string;
  offsetS: number;
  durationS: number;
}

export interface SegmentedRecorderOptions {
  segmentMs?: number;
  audioBitsPerSecond?: number;
  onSegment: (segment: RecordedSegment) => void;
  /** Para continuar uma aula já iniciada (app reaberto): próximo índice e tempo já gravado. */
  startIdx?: number;
  startOffsetS?: number;
  /** Para testes. */
  recorderCtor?: typeof MediaRecorder;
  now?: () => number;
}

const MIME_CANDIDATES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];

export function pickMimeType(isSupported: (t: string) => boolean): string {
  return MIME_CANDIDATES.find(isSupported) ?? "";
}

export function extensionFor(mimeType: string): string {
  if (mimeType.includes("mp4")) return "m4a";
  if (mimeType.includes("ogg")) return "ogg";
  return "webm";
}

export class SegmentedRecorder {
  private readonly segmentMs: number;
  private readonly bits: number;
  private readonly Ctor: typeof MediaRecorder;
  private readonly now: () => number;
  private readonly mimeType: string;
  private recorder: MediaRecorder | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private idx = 0;
  private startedAt = 0;
  private currentSeg: { start: number; end: number } | null = null;
  private stopping = false;
  private pending = 0;
  private drained: (() => void) | null = null;

  constructor(
    private readonly stream: MediaStream,
    private readonly opts: SegmentedRecorderOptions,
  ) {
    this.segmentMs = opts.segmentMs ?? 5 * 60 * 1000;
    this.bits = opts.audioBitsPerSecond ?? 32_000;
    this.Ctor = opts.recorderCtor ?? MediaRecorder;
    this.now = opts.now ?? (() => Date.now());
    this.mimeType = pickMimeType((t) => this.Ctor.isTypeSupported(t));
    this.idx = opts.startIdx ?? 0;
  }

  get recording(): boolean {
    return this.recorder !== null;
  }

  get elapsedS(): number {
    return this.startedAt ? (this.now() - this.startedAt) / 1000 : 0;
  }

  start(): void {
    if (this.recorder) return;
    this.stopping = false;
    this.startedAt = this.now() - (this.opts.startOffsetS ?? 0) * 1000;
    this.startSegment();
  }

  /** Finaliza o segmento atual e espera ele ser entregue em `onSegment`. */
  async stop(): Promise<void> {
    if (!this.recorder) return;
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const done = new Promise<void>((resolve) => (this.drained = resolve));
    this.endCurrentSegment();
    this.recorder.stop();
    this.recorder = null;
    await done;
  }

  private startSegment(): void {
    const recorder = new this.Ctor(this.stream, {
      mimeType: this.mimeType || undefined,
      audioBitsPerSecond: this.bits,
    });
    const idx = this.idx++;
    const chunks: Blob[] = [];
    const seg = { start: this.now(), end: 0 };
    const offsetS = (seg.start - this.startedAt) / 1000;
    this.currentSeg = seg;
    this.pending++;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    recorder.onstop = () => {
      const mimeType = recorder.mimeType || this.mimeType || "audio/webm";
      const durationS = ((seg.end || this.now()) - seg.start) / 1000;
      if (chunks.length) {
        this.opts.onSegment({ idx, blob: new Blob(chunks, { type: mimeType }), mimeType, offsetS, durationS });
      }
      this.pending--;
      if (this.stopping && this.pending === 0) this.drained?.();
    };

    recorder.start();
    this.recorder = recorder;
    this.timer = setTimeout(() => this.rotate(), this.segmentMs);
  }

  private rotate(): void {
    if (!this.recorder || this.stopping) return;
    const old = this.recorder;
    this.endCurrentSegment();
    old.stop();
    this.startSegment();
  }

  private endCurrentSegment(): void {
    if (this.currentSeg) this.currentSeg.end = this.now();
  }
}
