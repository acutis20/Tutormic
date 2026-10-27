import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { MicEngine } from "../audio/micEngine";
import { SegmentedRecorder } from "../audio/recorder";
import { canSelectOutput, ensureMicPermission, looksExternal, watchDevices, type AudioDevices } from "../audio/devices";
import { getLesson, getRecordingResume, updateLesson, type Lesson } from "../lib/api";
import { onQueueChange, uploadQueue } from "../lib/queue";
import LevelMeter from "../components/LevelMeter";
import DevicePicker from "../components/DevicePicker";
import BigMuteButton from "../components/BigMuteButton";

type Phase = "idle" | "starting" | "live" | "ending";

function formatElapsed(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return [h, m, sec].map((n) => String(n).padStart(2, "0")).join(":");
}

export default function LiveLesson() {
  const { id: lessonId = "" } = useParams();
  const navigate = useNavigate();

  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [devices, setDevices] = useState<AudioDevices>({ inputs: [], outputs: [] });
  const [inputId, setInputId] = useState("");
  const [outputId, setOutputId] = useState("default");
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(0.8);
  const [elapsed, setElapsed] = useState(0);
  const [pending, setPending] = useState(0);
  const [alert, setAlert] = useState<string | null>(null);
  const [suggested, setSuggested] = useState<MediaDeviceInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  const engineRef = useRef<MicEngine | null>(null);
  const recorderRef = useRef<SegmentedRecorder | null>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const phaseRef = useRef<Phase>("idle");
  phaseRef.current = phase;

  if (!engineRef.current) {
    engineRef.current = new MicEngine({
      onFeedback: (hz, newVolume) => {
        setVolume(newVolume);
        setAlert(
          `Microfonia detectada (~${Math.round(hz)} Hz). Abaixei o volume. Afaste o celular/microfone da caixa de som.`,
        );
      },
    });
  }
  const engine = engineRef.current;
  const getLevel = useCallback(() => engine.getLevel(), [engine]);

  useEffect(() => {
    getLesson(lessonId)
      .then((l) => {
        if (l.status !== "live") navigate(`/aula/${l.id}`, { replace: true });
        else setLesson(l);
      })
      .catch((e: Error) => setError(e.message));
  }, [lessonId, navigate]);

  useEffect(
    () =>
      watchDevices(setDevices, (device) => {
        if (phaseRef.current === "live" && looksExternal(device)) setSuggested(device);
      }),
    [],
  );

  useEffect(() => onQueueChange(() => void uploadQueue.pending(lessonId).then(setPending)), [lessonId]);

  useEffect(() => {
    if (phase !== "live") return;
    const t = window.setInterval(() => setElapsed(recorderRef.current?.elapsedS ?? 0), 500);
    return () => window.clearInterval(t);
  }, [phase]);

  // Ao sair da página, desliga tudo (a gravação já salva fica na fila).
  useEffect(
    () => () => {
      void recorderRef.current?.stop();
      void engine.stop();
      void wakeLockRef.current?.release();
    },
    [engine],
  );

  // A tela não pode apagar durante a aula; o wake lock cai quando o app vai para segundo plano.
  useEffect(() => {
    const onVisible = async () => {
      if (document.visibilityState === "visible" && phaseRef.current === "live" && "wakeLock" in navigator) {
        wakeLockRef.current = await navigator.wakeLock.request("screen").catch(() => null);
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  async function start() {
    setPhase("starting");
    setError(null);
    try {
      await ensureMicPermission();
      await engine.start(inputId || undefined, outputId !== "default" ? outputId : undefined);
      engine.setVolume(volume);

      const queued = await uploadQueue.items(lessonId);
      const resume = await getRecordingResume(lessonId, queued);
      const recorder = new SegmentedRecorder(engine.recordingStream, {
        startIdx: resume.nextIdx,
        startOffsetS: resume.offsetS,
        onSegment: (segment) => void uploadQueue.enqueue(lessonId, segment),
      });
      recorder.start();
      recorderRef.current = recorder;

      if ("wakeLock" in navigator) {
        wakeLockRef.current = await navigator.wakeLock.request("screen").catch(() => null);
      }
      setPhase("live");
    } catch (e) {
      await engine.stop();
      setError(
        (e as Error).name === "NotAllowedError"
          ? "Permita o acesso ao microfone nas configurações do navegador."
          : (e as Error).message,
      );
      setPhase("idle");
    }
  }

  async function changeInput(id: string) {
    setInputId(id);
    setSuggested(null);
    if (engine.running) {
      try {
        await engine.setInput(id);
      } catch (e) {
        setError(`Não foi possível usar este microfone: ${(e as Error).message}`);
      }
    }
  }

  async function changeOutput(id: string) {
    setOutputId(id);
    if (engine.running) {
      const ok = await engine.setOutput(id).catch(() => false);
      if (!ok) setError("Este navegador não permite escolher a saída. Use a saída de áudio do sistema.");
    }
  }

  function toggleMute() {
    engine.setMuted(!muted);
    setMuted(!muted);
  }

  function changeVolume(v: number) {
    setVolume(v);
    engine.setVolume(v);
  }

  async function end() {
    setPhase("ending");
    await recorderRef.current?.stop();
    recorderRef.current = null;
    await engine.stop();
    await wakeLockRef.current?.release();
    wakeLockRef.current = null;

    // Só marca como gravada quando todo o áudio estiver na nuvem.
    while (!(await uploadQueue.drain(lessonId, 30_000))) {
      setError("Ainda enviando o áudio da aula… Mantenha o app aberto e conectado à internet.");
    }
    await updateLesson(lessonId, { status: "recorded", ended_at: new Date().toISOString() });
    navigate(`/aula/${lessonId}`, { replace: true });
  }

  const outputSelectable = canSelectOutput();

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-5 p-4">
      <header className="flex items-center justify-between">
        <Link to="/" className="text-sm text-slate-400">
          ← Aulas
        </Link>
        {phase === "live" && (
          <span className="flex items-center gap-2 font-mono text-red-300" data-testid="rec-timer">
            <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" /> REC {formatElapsed(elapsed)}
          </span>
        )}
      </header>

      <h1 className="text-xl font-bold">{lesson?.title ?? "…"}</h1>

      {alert && (
        <button onClick={() => setAlert(null)} className="rounded-xl bg-amber-500/20 p-3 text-left text-sm text-amber-200">
          ⚠️ {alert}
        </button>
      )}

      {suggested && (
        <div className="rounded-xl bg-sky-500/15 p-3 text-sm">
          Novo microfone conectado: <b>{suggested.label}</b>
          <div className="mt-2 flex gap-2">
            <button className="rounded-lg bg-sky-500 px-3 py-1 font-semibold text-slate-950" onClick={() => changeInput(suggested.deviceId)}>
              Usar este
            </button>
            <button className="rounded-lg bg-slate-700 px-3 py-1" onClick={() => setSuggested(null)}>
              Agora não
            </button>
          </div>
        </div>
      )}

      {phase === "live" || phase === "ending" ? (
        <div className="flex flex-col items-center gap-5">
          <BigMuteButton muted={muted} onToggle={toggleMute} />
          <LevelMeter getLevel={getLevel} active={phase === "live" && !muted} />
          <label className="w-full">
            <span className="mb-1 flex justify-between text-sm text-slate-400">
              <span>Volume na caixa</span>
              <span>{Math.round(volume * 100)}%</span>
            </span>
            <input
              type="range"
              min={0}
              max={1.5}
              step={0.05}
              value={volume}
              onChange={(e) => changeVolume(Number(e.target.value))}
              className="w-full"
            />
          </label>
        </div>
      ) : (
        <button
          onClick={start}
          disabled={phase === "starting" || !lesson}
          className="rounded-2xl bg-sky-500 p-6 text-xl font-bold text-slate-950 disabled:opacity-50"
        >
          {phase === "starting" ? "Ligando…" : "🎙️ Ligar microfone e gravar"}
        </button>
      )}

      <section className="space-y-3 rounded-2xl bg-slate-900 p-4">
        <DevicePicker label="Microfone" devices={devices.inputs} value={inputId} onChange={changeInput} disabled={phase === "ending"} />
        {outputSelectable ? (
          <DevicePicker label="Saída (caixa de som)" devices={devices.outputs} value={outputId} onChange={changeOutput} disabled={phase === "ending"} />
        ) : (
          <p className="text-sm text-slate-400">
            Saída: a do sistema. Pareie a JBL nas configurações de Bluetooth do aparelho antes de começar.
          </p>
        )}
        <details className="text-sm text-slate-400">
          <summary className="cursor-pointer">Dicas para um som melhor</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Fone com fio: plugue e escolha o mic dele acima. Prenda o microfone do fio perto da boca, como lapela.</li>
            <li>O Bluetooth tem um pequeno atraso (0,15–0,3 s). Se a caixa tiver entrada P2/AUX, o cabo é melhor.</li>
            <li>Mantenha o microfone longe e atrás da caixa para evitar microfonia (apito).</li>
            <li>Deixe a tela ligada com o app aberto durante a aula.</li>
          </ul>
        </details>
      </section>

      {pending > 0 && <p className="text-center text-xs text-slate-500">Enviando áudio: {pending} parte(s) na fila</p>}
      {error && <p className="text-center text-sm text-red-300">{error}</p>}

      {phase === "live" && (
        <button onClick={end} className="mt-auto rounded-xl border border-red-500/50 p-4 font-semibold text-red-300">
          Encerrar aula
        </button>
      )}
      {phase === "ending" && <p className="mt-auto text-center text-slate-400">Finalizando e enviando a gravação…</p>}
    </main>
  );
}
