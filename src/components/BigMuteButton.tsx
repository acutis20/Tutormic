export default function BigMuteButton({ muted, onToggle }: { muted: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      aria-pressed={muted}
      className={`flex aspect-square w-full max-w-64 flex-col items-center justify-center rounded-full text-2xl font-bold shadow-lg transition-colors ${
        muted ? "bg-slate-700 text-slate-300" : "bg-sky-500 text-slate-950"
      }`}
    >
      <span className="text-6xl" aria-hidden>
        {muted ? "🔇" : "🎙️"}
      </span>
      <span className="mt-2">{muted ? "Mudo" : "No ar"}</span>
      <span className="text-sm font-normal opacity-70">toque para {muted ? "falar" : "silenciar"}</span>
    </button>
  );
}
