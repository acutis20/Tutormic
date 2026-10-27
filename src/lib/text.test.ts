import { describe, expect, it } from "vitest";
import {
  chunkForReview,
  joinTranscript,
  offsetSegments,
  stamp,
  stripStamps,
} from "../../supabase/functions/_shared/text";

describe("texto das Edge Functions", () => {
  it("aplica o offset do segmento e remove trechos vazios", () => {
    expect(
      offsetSegments(
        [
          { start: 0, end: 2, text: " Bom dia " },
          { start: 2, end: 3, text: "  " },
        ],
        300,
      ),
    ).toEqual([{ start: 300, end: 302, text: "Bom dia" }]);
  });

  it("junta a transcrição", () => {
    expect(joinTranscript([{ start: 0, end: 1, text: "Olá," }, { start: 1, end: 2, text: "turma." }])).toBe("Olá, turma.");
  });

  it("formata tempos", () => {
    expect(stamp(65)).toBe("1:05");
    expect(stamp(3725)).toBe("1:02:05");
  });

  it("divide em blocos pelo limite de palavras, com marcação de tempo", () => {
    const segs = Array.from({ length: 10 }, (_, i) => ({ start: i * 10, end: i * 10 + 9, text: "um dois três quatro" }));
    const chunks = chunkForReview(segs, 10);
    expect(chunks).toHaveLength(5);
    expect(chunks[0]).toBe("[0:00] um dois três quatro\n[0:10] um dois três quatro");
  });

  it("remove marcações de tempo do texto corrigido", () => {
    expect(stripStamps("[1:05] Bom dia. [1:02:05] Até logo.")).toBe("Bom dia. Até logo.");
  });
});
