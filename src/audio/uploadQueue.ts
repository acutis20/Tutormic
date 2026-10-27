import type { RecordedSegment } from "./recorder";

/**
 * Fila de upload dos segmentos. Cada segmento é salvo primeiro no aparelho (IndexedDB)
 * e só sai da fila depois de enviado. Se a internet cair no meio da aula, nada se perde:
 * a fila tenta de novo e retoma ao reabrir o app.
 */
export interface QueuedSegment extends Omit<RecordedSegment, "blob"> {
  key: string;
  lessonId: string;
  blob: Blob;
  attempts: number;
}

export interface QueueStore {
  put(item: QueuedSegment): Promise<void>;
  delete(key: string): Promise<void>;
  all(): Promise<QueuedSegment[]>;
}

export type Uploader = (item: QueuedSegment) => Promise<void>;

export interface UploadQueueOptions {
  store: QueueStore;
  upload: Uploader;
  onChange?: (pending: number) => void;
  retryDelayMs?: (attempt: number) => number;
}

const defaultDelay = (attempt: number) => Math.min(30_000, 1000 * 2 ** attempt);

export class UploadQueue {
  private running = false;
  private wake: (() => void) | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly opts: UploadQueueOptions) {}

  async enqueue(lessonId: string, segment: RecordedSegment): Promise<void> {
    await this.opts.store.put({
      ...segment,
      key: `${lessonId}:${String(segment.idx).padStart(4, "0")}`,
      lessonId,
      attempts: 0,
    });
    await this.notify();
    void this.process();
  }

  async pending(lessonId?: string): Promise<number> {
    return (await this.items(lessonId)).length;
  }

  async items(lessonId?: string): Promise<QueuedSegment[]> {
    const items = await this.opts.store.all();
    return lessonId ? items.filter((i) => i.lessonId === lessonId) : items;
  }

  /** Envia tudo o que estiver na fila. Resolve quando a fila esvazia ou após uma falha agendar retry. */
  async process(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const items = (await this.opts.store.all()).sort((a, b) => a.key.localeCompare(b.key));
      for (const item of items) {
        try {
          await this.opts.upload(item);
          await this.opts.store.delete(item.key);
          await this.notify();
        } catch (err) {
          console.warn("Falha no upload do segmento", item.key, err);
          item.attempts++;
          await this.opts.store.put(item);
          this.scheduleRetry(item.attempts);
          return;
        }
      }
    } finally {
      this.running = false;
      this.wake?.();
    }
  }

  /** Espera a fila de uma aula esvaziar (usado ao encerrar a aula). */
  async drain(lessonId: string, timeoutMs = 120_000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while ((await this.pending(lessonId)) > 0) {
      if (Date.now() > deadline) return false;
      if (!this.running) void this.process();
      await new Promise<void>((resolve) => {
        this.wake = resolve;
        setTimeout(resolve, 1000);
      });
    }
    return true;
  }

  private scheduleRetry(attempt: number): void {
    if (this.timer) clearTimeout(this.timer);
    const delay = (this.opts.retryDelayMs ?? defaultDelay)(attempt);
    this.timer = setTimeout(() => void this.process(), delay);
  }

  private async notify(): Promise<void> {
    if (this.opts.onChange) this.opts.onChange(await this.pending());
  }
}

/** Store em IndexedDB (sobrevive a fechar o app ou a bateria acabar). */
export function indexedDbStore(dbName = "tutormic", storeName = "segments"): QueueStore {
  const open = () =>
    new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(dbName, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(storeName, { keyPath: "key" });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  const dbPromise = open();

  const run = async <T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>) => {
    const db = await dbPromise;
    return new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(storeName, mode).objectStore(storeName));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  };

  return {
    put: async (item) => void (await run("readwrite", (s) => s.put(item))),
    delete: async (key) => void (await run("readwrite", (s) => s.delete(key))),
    all: () => run<QueuedSegment[]>("readonly", (s) => s.getAll() as IDBRequest<QueuedSegment[]>),
  };
}

export function memoryStore(): QueueStore {
  const map = new Map<string, QueuedSegment>();
  return {
    put: async (item) => void map.set(item.key, { ...item }),
    delete: async (key) => void map.delete(key),
    all: async () => [...map.values()].map((i) => ({ ...i })),
  };
}
