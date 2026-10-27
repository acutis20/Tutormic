/**
 * Detecta microfonia: um tom puro (um pico estreito bem acima do resto do espectro)
 * que fica estável por um tempo. Voz tem energia espalhada e muda o tempo todo, então
 * não dispara.
 *
 * Lógica pura sobre os dados do AnalyserNode (getFloatFrequencyData, em dB), para
 * poder ser testada sem Web Audio.
 */
export interface FeedbackGuardOptions {
  sampleRate: number;
  fftSize: number;
  /** Quanto o pico precisa ficar acima da média do espectro (dB). */
  prominenceDb?: number;
  /** Nível mínimo absoluto do pico (dBFS). */
  minPeakDb?: number;
  /** Por quanto tempo o mesmo pico precisa persistir (ms). */
  holdMs?: number;
  /** Faixa de frequência onde microfonia costuma acontecer (Hz). */
  minHz?: number;
  maxHz?: number;
}

export interface FeedbackGuardResult {
  feedback: boolean;
  frequencyHz: number | null;
}

export class FeedbackGuard {
  private readonly opts: Required<FeedbackGuardOptions>;
  private candidateBin = -1;
  private candidateSince = 0;

  constructor(options: FeedbackGuardOptions) {
    this.opts = {
      prominenceDb: 30,
      minPeakDb: -35,
      holdMs: 300,
      minHz: 200,
      maxHz: 8000,
      ...options,
    };
  }

  reset(): void {
    this.candidateBin = -1;
    this.candidateSince = 0;
  }

  /** `spectrum` em dB por bin; `now` em ms (performance.now()). */
  analyze(spectrum: Float32Array, now: number): FeedbackGuardResult {
    const { sampleRate, fftSize, prominenceDb, minPeakDb, holdMs, minHz, maxHz } = this.opts;
    const binHz = sampleRate / fftSize;
    const lo = Math.max(1, Math.floor(minHz / binHz));
    const hi = Math.min(spectrum.length - 1, Math.ceil(maxHz / binHz));

    let peakBin = -1;
    let peakDb = -Infinity;
    let sum = 0;
    let count = 0;
    for (let i = lo; i <= hi; i++) {
      const v = spectrum[i];
      if (!Number.isFinite(v)) continue;
      sum += v;
      count++;
      if (v > peakDb) {
        peakDb = v;
        peakBin = i;
      }
    }

    const mean = count ? sum / count : -Infinity;
    const isTonal = peakBin >= 0 && peakDb >= minPeakDb && peakDb - mean >= prominenceDb;

    if (!isTonal) {
      this.reset();
      return { feedback: false, frequencyHz: null };
    }

    if (this.candidateBin < 0 || Math.abs(peakBin - this.candidateBin) > 1) {
      this.candidateBin = peakBin;
      this.candidateSince = now;
    }

    const feedback = now - this.candidateSince >= holdMs;
    return { feedback, frequencyHz: feedback ? peakBin * binHz : null };
  }
}
