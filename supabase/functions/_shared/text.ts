// Funções puras (sem dependências) usadas pelas Edge Functions e testadas com vitest.

export interface TimedText {
  start: number;
  end: number;
  text: string;
}

/** Ajusta os tempos dos trechos do Whisper para o tempo absoluto da aula. */
export function offsetSegments(segments: TimedText[], offsetS: number): TimedText[] {
  return segments
    .map((s) => ({ start: s.start + offsetS, end: s.end + offsetS, text: s.text.trim() }))
    .filter((s) => s.text.length > 0);
}

export function joinTranscript(segments: TimedText[]): string {
  return segments
    .map((s) => s.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Formata segundos como [mm:ss] ou [h:mm:ss]. */
export function stamp(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(h ? 2 : 1, "0");
  const ss = String(sec).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * Agrupa os trechos em blocos de até `maxWords` palavras para revisão, com marcação de
 * tempo no início de cada trecho (o Claude usa isso para apontar onde está cada problema).
 */
export function chunkForReview(segments: TimedText[], maxWords = 1500): string[] {
  const chunks: string[] = [];
  let current: string[] = [];
  let words = 0;
  for (const seg of segments) {
    const n = seg.text.split(/\s+/).filter(Boolean).length;
    if (words > 0 && words + n > maxWords) {
      chunks.push(current.join("\n"));
      current = [];
      words = 0;
    }
    current.push(`[${stamp(seg.start)}] ${seg.text}`);
    words += n;
  }
  if (current.length) chunks.push(current.join("\n"));
  return chunks;
}

/** Remove marcações [mm:ss] que o modelo possa ter deixado no texto corrigido. */
export function stripStamps(text: string): string {
  return text
    .replace(/\[\d{1,2}(?::\d{2}){1,2}\]\s*/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();
}
