import { describe, expect, it } from "vitest";
import { FeedbackGuard } from "./feedbackGuard";

const SR = 48000;
const FFT = 4096;
const BINS = FFT / 2;
const binOf = (hz: number) => Math.round(hz / (SR / FFT));

function spectrum(fill: (i: number) => number): Float32Array {
  return Float32Array.from({ length: BINS }, (_, i) => fill(i));
}

describe("FeedbackGuard", () => {
  it("dispara para um tom puro que persiste", () => {
    const guard = new FeedbackGuard({ sampleRate: SR, fftSize: FFT });
    const tone = spectrum((i) => (i === binOf(2500) ? -10 : -90));
    expect(guard.analyze(tone, 0).feedback).toBe(false);
    expect(guard.analyze(tone, 200).feedback).toBe(false);
    const r = guard.analyze(tone, 350);
    expect(r.feedback).toBe(true);
    expect(r.frequencyHz).toBeGreaterThan(2450);
    expect(r.frequencyHz).toBeLessThan(2550);
  });

  it("não dispara para voz (energia espalhada)", () => {
    const guard = new FeedbackGuard({ sampleRate: SR, fftSize: FFT });
    for (let t = 0; t <= 1000; t += 50) {
      const voice = spectrum((i) => -40 - ((i * 7 + t) % 23));
      expect(guard.analyze(voice, t).feedback).toBe(false);
    }
  });

  it("não dispara se o pico muda de frequência", () => {
    const guard = new FeedbackGuard({ sampleRate: SR, fftSize: FFT });
    for (let t = 0; t <= 1000; t += 50) {
      const hz = 500 + (t / 50) * 200;
      const s = spectrum((i) => (i === binOf(hz) ? -10 : -90));
      expect(guard.analyze(s, t).feedback).toBe(false);
    }
  });

  it("ignora sons baixos", () => {
    const guard = new FeedbackGuard({ sampleRate: SR, fftSize: FFT });
    const quiet = spectrum((i) => (i === binOf(1000) ? -60 : -100));
    guard.analyze(quiet, 0);
    expect(guard.analyze(quiet, 500).feedback).toBe(false);
  });
});
