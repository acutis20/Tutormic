/**
 * Modo microfone + receptor.
 *
 * O aparelho da professora (transmissor) capta e grava; o som vai por WebRTC, direto pela rede,
 * para um ou mais receptores (PC da faculdade, notebook, Android) ligados na caixa de som.
 * Necessário no iPhone/iPad: com o microfone ligado, o iOS não toca em caixas Bluetooth comuns.
 *
 * A sinalização (troca de ofertas/respostas) passa por um canal de broadcast do Supabase
 * Realtime identificado por um código curto. O áudio em si não passa pelo servidor.
 */
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";

export type SignalMessage =
  | { type: "hello"; from: string }
  | { type: "sender-online" }
  | { type: "offer"; to: string; sdp: string }
  | { type: "answer"; from: string; sdp: string }
  | { type: "bye"; from: string };

export interface Signal {
  send(msg: SignalMessage): void;
  close(): void;
}

export type SignalFactory = (room: string, onMessage: (msg: SignalMessage) => void) => Promise<Signal>;

const ICE_SERVERS: RTCIceServer[] = [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
];

// Sem letras/números parecidos (0/O, 1/I/L) para ditar o código em voz alta.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function createRoomCode(length = 6, random: () => number = Math.random): string {
  return Array.from({ length }, () => CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)]).join("");
}

export function normalizeRoomCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 6);
}

/** Sinalização via Supabase Realtime (broadcast). */
export const supabaseSignal: SignalFactory = (room, onMessage) =>
  new Promise((resolve, reject) => {
    const channel: RealtimeChannel = supabase.channel(`tutormic-room-${room}`, {
      config: { broadcast: { self: false, ack: false } },
    });
    channel.on("broadcast", { event: "signal" }, ({ payload }) => onMessage(payload as SignalMessage));
    let settled = false;
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED" && !settled) {
        settled = true;
        resolve({
          send: (msg) => void channel.send({ type: "broadcast", event: "signal", payload: msg }),
          close: () => void supabase.removeChannel(channel),
        });
      } else if ((status === "CHANNEL_ERROR" || status === "TIMED_OUT") && !settled) {
        settled = true;
        reject(new Error("Não foi possível conectar ao servidor de pareamento."));
      }
    });
  });

/** Sinalização entre abas do mesmo navegador (usada nos testes automatizados). */
export const localSignal: SignalFactory = async (room, onMessage) => {
  const bc = new BroadcastChannel(`tutormic-room-${room}`);
  bc.onmessage = (e) => onMessage(e.data as SignalMessage);
  return { send: (msg) => bc.postMessage(msg), close: () => bc.close() };
};

/** Usa a sinalização local se a URL tiver ?signal=local (testes); senão o Supabase. */
export function defaultSignal(): SignalFactory {
  return new URLSearchParams(location.search).get("signal") === "local" ? localSignal : supabaseSignal;
}

/** Espera o ICE terminar de coletar candidatos (SDP completo, sem trickle). */
function waitForIce(pc: RTCPeerConnection, timeoutMs = 2500): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      pc.removeEventListener("icegatheringstatechange", check);
      resolve();
    };
    const check = () => pc.iceGatheringState === "complete" && done();
    pc.addEventListener("icegatheringstatechange", check);
    setTimeout(done, timeoutMs);
  });
}

/** Pede ao navegador o menor atraso possível no buffer de recepção. */
function minimizeLatency(receiver: RTCRtpReceiver): void {
  const r = receiver as unknown as { jitterBufferTarget?: number | null; playoutDelayHint?: number };
  try {
    if ("jitterBufferTarget" in receiver) r.jitterBufferTarget = 0;
    else r.playoutDelayHint = 0;
  } catch {
    /* navegador sem suporte: usa o padrão */
  }
}

// ------------------------------------------------------------------ transmissor
export class MicTransmitter {
  private signal: Signal | null = null;
  private peers = new Map<string, RTCPeerConnection>();

  constructor(
    private readonly room: string,
    private readonly stream: MediaStream,
    private readonly onListeners: (count: number) => void,
    private readonly signalFactory: SignalFactory = defaultSignal(),
  ) {}

  async start(): Promise<void> {
    this.signal = await this.signalFactory(this.room, (msg) => void this.handle(msg));
    this.signal.send({ type: "sender-online" });
  }

  private async handle(msg: SignalMessage): Promise<void> {
    if (msg.type === "hello") await this.connect(msg.from);
    else if (msg.type === "answer") await this.peers.get(msg.from)?.setRemoteDescription({ type: "answer", sdp: msg.sdp });
    else if (msg.type === "bye") this.drop(msg.from);
  }

  private async connect(id: string): Promise<void> {
    this.drop(id);
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    this.peers.set(id, pc);
    for (const track of this.stream.getAudioTracks()) pc.addTrack(track, this.stream);
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" || pc.connectionState === "closed") this.drop(id);
      this.report();
    };
    await pc.setLocalDescription(await pc.createOffer());
    await waitForIce(pc);
    this.signal?.send({ type: "offer", to: id, sdp: pc.localDescription!.sdp });
  }

  private drop(id: string): void {
    const pc = this.peers.get(id);
    if (!pc) return;
    this.peers.delete(id);
    pc.close();
    this.report();
  }

  private report(): void {
    const connected = [...this.peers.values()].filter((p) => p.connectionState === "connected").length;
    this.onListeners(connected);
  }

  stop(): void {
    for (const id of [...this.peers.keys()]) this.drop(id);
    this.signal?.close();
    this.signal = null;
  }
}

// ------------------------------------------------------------------ receptor
export type ReceiverStatus = "connecting" | "waiting" | "connected" | "reconnecting";

export class SpeakerReceiver {
  private readonly id = crypto.randomUUID();
  private signal: Signal | null = null;
  private pc: RTCPeerConnection | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(
    private readonly room: string,
    private readonly onStream: (stream: MediaStream) => void,
    private readonly onStatus: (status: ReceiverStatus) => void,
    private readonly signalFactory: SignalFactory = defaultSignal(),
  ) {}

  async start(): Promise<void> {
    this.onStatus("connecting");
    this.signal = await this.signalFactory(this.room, (msg) => void this.handle(msg));
    this.onStatus("waiting");
    this.sayHello();
  }

  private sayHello(): void {
    if (this.stopped) return;
    this.signal?.send({ type: "hello", from: this.id });
    // Se o transmissor ainda não estiver no ar, tenta de novo periodicamente.
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      if (this.pc?.connectionState !== "connected") this.sayHello();
    }, 5000);
  }

  private async handle(msg: SignalMessage): Promise<void> {
    if (msg.type === "sender-online") {
      this.sayHello();
    } else if (msg.type === "offer" && msg.to === this.id) {
      this.pc?.close();
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      this.pc = pc;
      pc.ontrack = (e) => {
        minimizeLatency(e.receiver);
        this.onStream(e.streams[0] ?? new MediaStream([e.track]));
      };
      pc.onconnectionstatechange = () => {
        if (pc !== this.pc) return;
        if (pc.connectionState === "connected") this.onStatus("connected");
        else if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
          this.onStatus("reconnecting");
          this.sayHello();
        }
      };
      await pc.setRemoteDescription({ type: "offer", sdp: msg.sdp });
      await pc.setLocalDescription(await pc.createAnswer());
      await waitForIce(pc);
      this.signal?.send({ type: "answer", from: this.id, sdp: pc.localDescription!.sdp });
    }
  }

  stop(): void {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.signal?.send({ type: "bye", from: this.id });
    this.pc?.close();
    this.signal?.close();
  }
}
