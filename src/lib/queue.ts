import { indexedDbStore, memoryStore, UploadQueue } from "../audio/uploadQueue";
import { uploadSegment } from "./api";

type Listener = (pending: number) => void;
const listeners = new Set<Listener>();

export const uploadQueue = new UploadQueue({
  store: typeof indexedDB !== "undefined" ? indexedDbStore() : memoryStore(),
  upload: uploadSegment,
  onChange: (pending) => listeners.forEach((l) => l(pending)),
});

export function onQueueChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Retoma uploads que ficaram pendentes (app fechado, internet caiu).
window.addEventListener("online", () => void uploadQueue.process());
