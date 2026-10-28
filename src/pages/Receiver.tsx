import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useParams } from "react-router-dom";
import { normalizeRoomCode, SpeakerReceiver, type ReceiverStatus } from "../live/relay";
import LevelMeter from "../components/LevelMeter";

const STATUS_TEXT: Record<ReceiverStatus, string> = {
  connecting: "Conectando…",
  waiting: "Aguardando o microfone da professora…",
  connected: "Conectado: tocando a aula 🔊",
  reconnecting: "Conexão caiu, reconectando…",
};

type SinkAudio = HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };

/**
 * Aparelho ligado à caixa de som (PC da faculdade, notebook, Android). Não usa microfone:
 * só toca o som que vem do celular da professora. Não precisa de login.
 */
export default function Receiver() {
  const { code: codeParam = "" } = useParams();
  const [code, setCode] = useState(normalizeRoomCode(codeParam));
  const [status, setStatus] = useState<ReceiverStatus | null>(null);
  const [volume, setVolume] = useState(1);
  const [outputs, setOutputs] = useState<MediaDeviceInfo[]>([]);
  const [outputId, setOutputId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const audioRef = useRef<SinkAudio | null>(null);
  const receiverRef = useRef<SpeakerReceiver | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const bufRef = useRef(new Float32Array(2048));
  const wakeRef = useRef<WakeLockSentinel | null>(null);

  const getLevel = useCallback(() => {
    const analyser = analyserRef.current;
    if (!analyser) return 0;
    analyser.getFloatTimeDomainData(bufRef.current);
    let sum = 0;
    for (const v of bufRef.current) sum += v * v;
    const db = 20 * Math.log10(Math.sqrt(sum / bufRef.current.length) || 1e-8);
    return Math.min(1, Math.max(0, (db + 60) / 60));
  }, []);

  useEffect(
    () => () => {
      receiverRef.current?.stop();
      void ctxRef.current?.close();
      void wakeRef.current?.release();
    },
    [],
  );

  async function connect(e: FormEvent) {
    e.preventDefault();
    if (code.length !== 6) {
      setError("O código tem 6 letras/números.");
      return;
    }
    setError(null);

    // Tudo isto acontece no próprio toque, para o navegador liberar o som.
    const audio = (audioRef.current ??= new Audio() as SinkAudio);
    audio.autoplay = true;
    audio.volume = volume;
    const ctx = (ctxRef.current ??= new AudioContext());
    void ctx.resume();
    void audio.play().catch(() => undefined);

    receiverRef.current?.stop();
    const receiver = new SpeakerReceiver(
      code,
      (stream) => {
        audio.srcObject = stream;
        void audio.play().catch(() => setError("Toque em qualquer lugar da tela para liberar o som."));
        const analyser = new AnalyserNode(ctx, { fftSize: 2048 });
        ctx.createMediaStreamSource(stream).connect(analyser);
        analyserRef.current = analyser;
      },
      setStatus,
    );
    receiverRef.current = receiver;
    try {
      await receiver.start();
    } catch (err) {
      setError((err as Error).message);
      setStatus(null);
      return;
    }
    history.replaceState(null, "", `/receptor/${code}${location.search}`);

    if ("wakeLock" in navigator) wakeRef.current = await navigator.wakeLock.request("screen").catch(() => null);
    if (typeof audio.setSinkId === "function") {
      const devices = await navigator.mediaDevices?.enumerateDevices().catch(() => []);
      setOutputs((devices ?? []).filter((d) => d.kind === "audiooutput"));
    }
  }

  function changeVolume(v: number) {
    setVolume(v);
    if (audioRef.current) audioRef.current.volume = v;
  }

  async function changeOutput(id: string) {
    setOutputId(id);
    await audioRef.current?.setSinkId?.(id).catch(() => setError("Não foi possível usar essa saída."));
  }

  return (
    <main
      className="mx-auto flex min-h-dvh max-w-md flex-col gap-5 p-6"
      onClick={() => void audioRef.current?.play().catch(() => undefined)}
    >
      <h1 className="text-2xl font-bold">🔈 TutorMic · Receptor</h1>
      <p className="text-slate-400">
        Use este aparelho ligado à caixa de som (Bluetooth ou cabo). Ele só toca o som; o microfone é o celular da
        professora.
      </p>

      {!status ? (
        <form onSubmit={connect} className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-sm text-slate-400">Código que aparece no celular da professora</span>
            <input
              className="w-full rounded-xl bg-slate-800 p-4 text-center font-mono text-3xl tracking-[0.4em] uppercase"
              value={code}
              onChange={(e) => setCode(normalizeRoomCode(e.target.value))}
              placeholder="ABC123"
              autoCapitalize="characters"
              autoComplete="off"
              inputMode="text"
              data-testid="room-code"
            />
          </label>
          <button className="w-full rounded-2xl bg-sky-500 p-5 text-xl font-bold text-slate-950">Conectar e tocar</button>
        </form>
      ) : (
        <section className="space-y-4 rounded-2xl bg-slate-900 p-4">
          <p className="font-mono text-sm text-slate-400">Código {code}</p>
          <p className={`text-lg font-semibold ${status === "connected" ? "text-emerald-300" : "text-amber-200"}`} data-testid="receiver-status">
            {STATUS_TEXT[status]}
          </p>
          <LevelMeter getLevel={getLevel} active={status === "connected"} />
          <label className="block">
            <span className="mb-1 flex justify-between text-sm text-slate-400">
              <span>Volume</span>
              <span>{Math.round(volume * 100)}%</span>
            </span>
            <input type="range" min={0} max={1} step={0.05} value={volume} onChange={(e) => changeVolume(Number(e.target.value))} className="w-full" />
          </label>
          {outputs.length > 1 && (
            <label className="block">
              <span className="mb-1 block text-sm text-slate-400">Saída</span>
              <select className="w-full rounded-lg bg-slate-800 p-3" value={outputId} onChange={(e) => changeOutput(e.target.value)}>
                {outputs.map((d, i) => (
                  <option key={d.deviceId || i} value={d.deviceId}>
                    {d.label || `Saída ${i + 1}`}
                  </option>
                ))}
              </select>
            </label>
          )}
          <p className="text-xs text-slate-500">
            Deixe esta tela aberta durante a aula. Os dois aparelhos funcionam melhor na mesma rede Wi‑Fi.
          </p>
        </section>
      )}

      {error && <p className="text-sm text-red-300">{error}</p>}
    </main>
  );
}
