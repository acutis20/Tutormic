import { describe, expect, it } from "vitest";
import { memoryStore, UploadQueue, type QueuedSegment } from "./uploadQueue";

const seg = (idx: number) => ({
  idx,
  blob: new Blob(["x"]),
  mimeType: "audio/webm",
  offsetS: idx * 300,
  durationS: 300,
});

describe("UploadQueue", () => {
  it("envia em ordem e esvazia a fila", async () => {
    const sent: string[] = [];
    const queue = new UploadQueue({ store: memoryStore(), upload: async (i) => void sent.push(i.key) });
    await queue.enqueue("L1", seg(1));
    await queue.enqueue("L1", seg(0));
    expect(await queue.drain("L1", 2000)).toBe(true);
    expect(sent).toContain("L1:0000");
    expect(sent).toContain("L1:0001");
    expect(await queue.pending()).toBe(0);
  });

  it("mantém o segmento na fila quando o upload falha e tenta de novo", async () => {
    let fail = true;
    const sent: QueuedSegment[] = [];
    const queue = new UploadQueue({
      store: memoryStore(),
      retryDelayMs: () => 10,
      upload: async (i) => {
        if (fail) {
          fail = false;
          throw new Error("offline");
        }
        sent.push(i);
      },
    });
    await queue.enqueue("L1", seg(0));
    expect(await queue.drain("L1", 3000)).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0].attempts).toBe(1);
  });

  it("conta pendências por aula", async () => {
    const queue = new UploadQueue({
      store: memoryStore(),
      upload: () => new Promise(() => {}),
    });
    await queue.enqueue("A", seg(0));
    await queue.enqueue("B", seg(0));
    expect(await queue.pending("A")).toBe(1);
    expect(await queue.pending()).toBe(2);
  });
});
