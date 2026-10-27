import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { extensionFor, pickMimeType, SegmentedRecorder, type RecordedSegment } from "./recorder";

class FakeRecorder {
  static instances: FakeRecorder[] = [];
  static isTypeSupported = (t: string) => t === "audio/webm;codecs=opus";
  mimeType: string;
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  state = "inactive";
  constructor(_stream: unknown, opts: { mimeType?: string }) {
    this.mimeType = opts.mimeType ?? "";
    FakeRecorder.instances.push(this);
  }
  start() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    // Como no navegador: dados e onstop chegam de forma assíncrona.
    queueMicrotask(() => {
      this.ondataavailable?.({ data: new Blob(["audio"]) });
      this.onstop?.();
    });
  }
}

describe("SegmentedRecorder", () => {
  let now = 0;
  beforeEach(() => {
    vi.useFakeTimers();
    FakeRecorder.instances = [];
    now = 0;
  });
  afterEach(() => vi.useRealTimers());

  const make = (segments: RecordedSegment[], extra = {}) =>
    new SegmentedRecorder({} as MediaStream, {
      segmentMs: 1000,
      onSegment: (s) => segments.push(s),
      recorderCtor: FakeRecorder as unknown as typeof MediaRecorder,
      now: () => now,
      ...extra,
    });

  it("gera segmentos independentes com offset e duração corretos", async () => {
    const segments: RecordedSegment[] = [];
    const rec = make(segments);
    rec.start();
    now = 1000;
    vi.advanceTimersByTime(1000);
    now = 2000;
    vi.advanceTimersByTime(1000);
    now = 2500;
    await rec.stop();

    expect(FakeRecorder.instances).toHaveLength(3);
    expect(segments.map((s) => [s.idx, s.offsetS, s.durationS])).toEqual([
      [0, 0, 1],
      [1, 1, 1],
      [2, 2, 0.5],
    ]);
    expect(segments[0].mimeType).toBe("audio/webm;codecs=opus");
    expect(rec.recording).toBe(false);
  });

  it("continua a numeração e o tempo ao retomar uma aula", async () => {
    const segments: RecordedSegment[] = [];
    const rec = make(segments, { startIdx: 5, startOffsetS: 300 });
    rec.start();
    now = 400;
    await rec.stop();
    expect(segments[0]).toMatchObject({ idx: 5, offsetS: 300, durationS: 0.4 });
    expect(rec.elapsedS).toBeCloseTo(300.4);
  });
});

describe("helpers de formato", () => {
  it("escolhe o primeiro formato suportado", () => {
    expect(pickMimeType((t) => t === "audio/mp4")).toBe("audio/mp4");
    expect(pickMimeType(() => false)).toBe("");
  });
  it("extensão por formato", () => {
    expect(extensionFor("audio/webm;codecs=opus")).toBe("webm");
    expect(extensionFor("audio/mp4")).toBe("m4a");
  });
});
