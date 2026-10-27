import type { IssueStatus, IssueType, ReviewIssue } from "./api";

export const ISSUE_LABELS: Record<IssueType, string> = {
  conteudo: "Conteúdo",
  fala: "Clareza da fala",
  transcricao: "Transcrição",
};

/** No texto final, "pending" e "accepted" têm a correção aplicada; "rejected" volta ao original. */
const isApplied = (s: IssueStatus) => s !== "rejected";

/**
 * Muda a decisão sobre uma sugestão e ajusta o texto final.
 * Retorna o novo texto, ou null se o trecho não foi encontrado (a professora já editou à mão).
 */
export function applyIssueDecision(text: string, issue: ReviewIssue, next: IssueStatus): string | null {
  const wasApplied = isApplied(issue.status);
  const willApply = isApplied(next);
  if (wasApplied === willApply) return text;

  const [from, to] = willApply ? [issue.original, issue.replacement] : [issue.replacement, issue.original];
  const at = text.indexOf(from);
  if (at < 0) return null;
  return text.slice(0, at) + to + text.slice(at + from.length);
}
