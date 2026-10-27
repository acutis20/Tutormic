import type { LessonStatus } from "../lib/api";

const STATUS: Record<LessonStatus, { label: string; className: string }> = {
  live: { label: "Ao vivo", className: "bg-red-500/20 text-red-300" },
  recorded: { label: "Gravada", className: "bg-slate-500/20 text-slate-300" },
  transcribing: { label: "Transcrevendo", className: "bg-amber-500/20 text-amber-300" },
  reviewing: { label: "Revisando", className: "bg-amber-500/20 text-amber-300" },
  ready: { label: "Pronta para revisar", className: "bg-sky-500/20 text-sky-300" },
  published: { label: "Publicada", className: "bg-emerald-500/20 text-emerald-300" },
  failed: { label: "Erro no processamento", className: "bg-red-500/20 text-red-300" },
};

export default function StatusBadge({ status }: { status: LessonStatus }) {
  const s = STATUS[status];
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${s.className}`}>{s.label}</span>;
}
