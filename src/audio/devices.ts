export interface AudioDevices {
  inputs: MediaDeviceInfo[];
  outputs: MediaDeviceInfo[];
}

/** Pede permissão do microfone uma vez para que os rótulos dos dispositivos apareçam. */
export async function ensureMicPermission(): Promise<void> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  stream.getTracks().forEach((t) => t.stop());
}

export async function listAudioDevices(): Promise<AudioDevices> {
  const all = await navigator.mediaDevices.enumerateDevices();
  return {
    inputs: all.filter((d) => d.kind === "audioinput"),
    outputs: all.filter((d) => d.kind === "audiooutput"),
  };
}

/** Escolher a saída pelo app só funciona em Chrome/Edge/Android. No iOS a saída é a do sistema. */
export function canSelectOutput(): boolean {
  return (
    typeof AudioContext !== "undefined" &&
    ("setSinkId" in AudioContext.prototype || "setSinkId" in HTMLMediaElement.prototype)
  );
}

const EXTERNAL_HINTS = /(headset|fone|earphone|headphone|usb|lapela|lavalier|externo|external|wired|p2)/i;

/** Heurística para destacar um mic externo (fone com fio, USB, lapela). */
export function looksExternal(device: MediaDeviceInfo): boolean {
  return EXTERNAL_HINTS.test(device.label) && !/default|padrão/i.test(device.deviceId);
}

/**
 * Observa entradas/saídas plugadas ou removidas. Chama `onNewInput` quando um novo
 * microfone aparece (por exemplo, um fone com fio plugado durante a aula).
 */
export function watchDevices(
  onChange: (devices: AudioDevices) => void,
  onNewInput?: (device: MediaDeviceInfo) => void,
): () => void {
  let known = new Set<string>();
  let first = true;

  const refresh = async () => {
    const devices = await listAudioDevices();
    if (!first && onNewInput) {
      for (const d of devices.inputs) {
        if (d.deviceId && !known.has(d.deviceId) && d.deviceId !== "default") onNewInput(d);
      }
    }
    known = new Set(devices.inputs.map((d) => d.deviceId));
    first = false;
    onChange(devices);
  };

  void refresh();
  navigator.mediaDevices.addEventListener("devicechange", refresh);
  return () => navigator.mediaDevices.removeEventListener("devicechange", refresh);
}
