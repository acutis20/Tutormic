import { describe, expect, it } from "vitest";
import { applyIssueDecision } from "./issues";
import type { ReviewIssue } from "./api";

const issue: ReviewIssue = {
  id: 0,
  type: "conteudo",
  status: "pending",
  original: "o coração tem três câmaras",
  replacement: "o coração tem quatro câmaras",
  explanation: "O coração humano tem quatro câmaras.",
  timestamp: "12:30",
};

const corrected = "Hoje vimos que o coração tem quatro câmaras e bombeia sangue.";

describe("applyIssueDecision", () => {
  it("manter original desfaz a correção no texto", () => {
    expect(applyIssueDecision(corrected, issue, "rejected")).toBe(
      "Hoje vimos que o coração tem três câmaras e bombeia sangue.",
    );
  });

  it("aceitar depois de rejeitar reaplica a correção", () => {
    const rejected = applyIssueDecision(corrected, issue, "rejected")!;
    expect(applyIssueDecision(rejected, { ...issue, status: "rejected" }, "accepted")).toBe(corrected);
  });

  it("aceitar uma sugestão pendente não muda o texto (já está aplicada)", () => {
    expect(applyIssueDecision(corrected, issue, "accepted")).toBe(corrected);
  });

  it("retorna null se o trecho não existe mais", () => {
    expect(applyIssueDecision("texto editado à mão", issue, "rejected")).toBeNull();
  });
});
