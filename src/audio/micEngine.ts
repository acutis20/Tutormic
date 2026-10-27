import { FeedbackGuard } from "./feedbackGuard";

/**
 * Microfone ao vivo:
 *
 *   mic → passa-alta (~90 Hz) → compressor/limitador → mudo ─┬→ volume → saída (JBL etc.)
 *                                                           ├→ gravação
 *                                                           └→ analisador (medidor + anti-microfonia)
 */
export interface MicEngineEvents {
  onFeedback?: (frequencyHz: number, newVolume: number) => void;
}

type SinkCapable = { setSinkId?: (id: string) => Promise<void> };

const FEEDBACK_VOLUME_STEP = 0.7;
const MIN_AUTO_VOLUME = 0.2;

export class MicEngine {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private highpass!: BiquadFilterNode;
  private compressor!: DynamicsCompressorNode;
  private muteGain!: GainNode;
  private volumeGain!: GainNode;
  private analyser!: AnalyserNode;
  private recordDest!: MediaStreamAudioDestinationNode;
  private fallbackDest: MediaStreamAudioDestinationNode | null = null;
  private fallbackEl: HTMLAudioElement | null = null;
  private guard!: FeedbackGuard;
  private guardTimer: number | null = null;
  private timeBuf = new Float32Array(0);
  private freqBuf = new Float32Array(0);
  private volume = 0.8;

  constructor(private readonly events: MicEngineEvents = {}) {}

  get running(): boolean {
    return this.ctx !== null;
  }

  /** Stream processado para o MediaRecorder. */
  get recordingStream(): MediaStream {
    if (!this.ctx) throw new Error("Microfone não iniciado");
    return this.recordDest.stream;
  }

  async start(inputId?: string, outputId?: string): Promise<void> {
    if (this.ctx) return;
    const ctx = new AudioContext({ latencyHint: "interactive" });
    this.ctx = ctx;

    this.highpass = new BiquadFilterNode(ctx, { type: "highpass", frequency: 90, Q: 0.7 });
    this.compressor = new DynamicsCompressorNode(ctx, {
      threshold: -18,
      knee: 6,
      ratio: 12,
      attack: 0.003,
      release: 0.15,
    });
    this.muteGain = new GainNode(ctx, { gain: 1 });
    this.volumeGain = new GainNode(ctx, { gain: this.volume });
    this.analyser = new AnalyserNode(ctx, { fftSize: 4096, smoothingTimeConstant: 0.2 });
    this.recordDest = ctx.createMediaStreamDestination();

    this.highpass.connect(this.compressor).connect(this.muteGain);
    this.muteGain.connect(this.volumeGain).connect(ctx.destination);
    this.muteGain.connect(this.recordDest);
    this.muteGain.connect(this.analyser);

    this.timeBuf = new Float32Array(this.analyser.fftSize);
    this.freqBuf = new Float32Array(this.analyser.frequencyBinCount);
    this.guard = new FeedbackGuard({ sampleRate: ctx.sampleRate, fftSize: this.analyser.fftSize });

    await this.setInput(inputId);
    if (outputId) await this.setOutput(outputId);
    if (ctx.state === "suspended") await ctx.resume();
    this.guardTimer = window.setInterval(() => this.checkFeedback(), 50);
  }

  /** Troca o microfone sem interromper a aula (ex.: fone com fio plugado agora). */
  async setInput(deviceId?: string): Promise<void> {
    if (!this.ctx) throw new Error("Microfone não iniciado");
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        // Cancelamento de eco atrapalha num microfone ao vivo.
        echoCancellation: false,
        noiseSuppression: true,
        autoGainControl: false,
      },
    });
    const source = this.ctx.createMediaStreamSource(stream);
    source.connect(this.highpass);

    this.source?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.source = source;
    this.stream = stream;
    this.guard.reset();
  }

  /**
   * Escolhe a saída de áudio (JBL via Bluetooth, fone, alto-falante).
   * Retorna false se o navegador não permitir escolher (iOS/Safari): nesse caso
   * a saída é a que estiver ativa no sistema.
   */
  async setOutput(deviceId: string): Promise<boolean> {
    if (!this.ctx) throw new Error("Microfone não iniciado");
    const sinkCtx = this.ctx as unknown as SinkCapable;
    if (typeof sinkCtx.setSinkId === "function") {
      await sinkCtx.setSinkId(deviceId === "default" ? "" : deviceId);
      return true;
    }

    const el = document.createElement("audio") as HTMLAudioElement & SinkCapable;
    if (typeof el.setSinkId !== "function") return false;

    if (!this.fallbackDest) {
      this.fallbackDest = this.ctx.createMediaStreamDestination();
      this.volumeGain.disconnect(this.ctx.destination);
      this.volumeGain.connect(this.fallbackDest);
      el.srcObject = this.fallbackDest.stream;
      el.autoplay = true;
      this.fallbackEl = el;
    }
    const target = this.fallbackEl as HTMLAudioElement & SinkCapable;
    await target.setSinkId!(deviceId === "default" ? "" : deviceId);
    await target.play();
    return true;
  }

  setVolume(volume: number): void {
    this.volume = Math.min(1.5, Math.max(0, volume));
    if (this.ctx) this.volumeGain.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.02);
  }

  getVolume(): number {
    return this.volume;
  }

  setMuted(muted: boolean): void {
    if (this.ctx) this.muteGain.gain.setTargetAtTime(muted ? 0 : 1, this.ctx.currentTime, 0.01);
  }

  /** Nível de entrada de 0 a 1 para o medidor. */
  getLevel(): number {
    if (!this.ctx) return 0;
    this.analyser.getFloatTimeDomainData(this.timeBuf);
    let sum = 0;
    for (const v of this.timeBuf) sum += v * v;
    const rms = Math.sqrt(sum / this.timeBuf.length);
    const db = 20 * Math.log10(rms || 1e-8);
    return Math.min(1, Math.max(0, (db + 60) / 60));
  }

  private checkFeedback(): void {
    if (!this.ctx) return;
    this.analyser.getFloatFrequencyData(this.freqBuf);
    const result = this.guard.analyze(this.freqBuf, performance.now());
    if (!result.feedback || result.frequencyHz === null) return;

    const newVolume = Math.max(MIN_AUTO_VOLUME, this.volume * FEEDBACK_VOLUME_STEP);
    this.setVolume(newVolume);
    this.guard.reset();
    this.events.onFeedback?.(result.frequencyHz, newVolume);
  }

  async stop(): Promise<void> {
    if (this.guardTimer !== null) window.clearInterval(this.guardTimer);
    this.guardTimer = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.fallbackEl?.pause();
    await this.ctx?.close();
    this.ctx = null;
    this.stream = null;
    this.source = null;
    this.fallbackDest = null;
    this.fallbackEl = null;
  }
}
