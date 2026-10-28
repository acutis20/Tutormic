import { describe, expect, it } from "vitest";
import { createRoomCode, normalizeRoomCode } from "./relay";

describe("código do receptor", () => {
  it("tem 6 caracteres sem letras/números ambíguos", () => {
    for (let i = 0; i < 200; i++) {
      const code = createRoomCode();
      expect(code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
      expect(code).not.toMatch(/[01OIL]/);
    }
  });

  it("normaliza o que a pessoa digita", () => {
    expect(normalizeRoomCode(" abc-12x9 ")).toBe("ABC12X");
    expect(normalizeRoomCode("k7p q2m")).toBe("K7PQ2M");
  });
});
