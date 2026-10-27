import { useEffect, useRef } from "react";

/** Medidor de nível do microfone (verde → amarelo → vermelho). */
export default function LevelMeter({ getLevel, active }: { getLevel: () => number; active: boolean }) {
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!active) {
      if (barRef.current) barRef.current.style.width = "0%";
      return;
    }
    let raf = 0;
    const tick = () => {
      const level = getLevel();
      const bar = barRef.current;
      if (bar) {
        bar.style.width = `${Math.round(level * 100)}%`;
        bar.style.backgroundColor = level > 0.9 ? "#ef4444" : level > 0.7 ? "#facc15" : "#22c55e";
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [getLevel, active]);

  return (
    <div className="h-4 w-full overflow-hidden rounded-full bg-slate-800" role="meter" aria-label="Nível do microfone" data-testid="level-meter">
      <div ref={barRef} className="h-full w-0 transition-[width] duration-75" />
    </div>
  );
}
