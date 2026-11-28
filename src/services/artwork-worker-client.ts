import type { ArtworkOperation, ArtworkOperationResult } from "./artwork-operations";
import ArtworkWorker from "./artwork-worker?worker";

let worker: Worker | null = null;
let sequence = 0;
const pending = new Map<number, (result: ArtworkOperationResult) => void>();

export function artworkOperation(
  operation: ArtworkOperation,
  signal?: AbortSignal,
): Promise<ArtworkOperationResult> {
  if (signal?.aborted) {
    if (operation.kind === "pixels") operation.bitmap.close();
    return Promise.resolve(null);
  }
  try {
    if (!worker) {
      const current = new ArtworkWorker();
      worker = current;
      current.onmessage = ({ data }) => {
        const resolve = pending.get(data.id);
        pending.delete(data.id);
        if (resolve) resolve(data.result);
        else data.result?.close?.();
      };
      current.onerror = () => {
        if (worker !== current) return;
        current.terminate();
        worker = null;
        for (const resolve of pending.values()) resolve(null);
        pending.clear();
      };
    }
    const current = worker;
    const id = ++sequence;
    return new Promise((resolve) => {
      const abort = () => {
        try {
          current.postMessage({ id });
        } catch {
          // A failed worker already resolves its pending jobs through onerror.
        }
      };
      pending.set(id, (result) => {
        signal?.removeEventListener("abort", abort);
        resolve(result);
      });
      try {
        current.postMessage(
          { id, operation },
          operation.kind === "pixels" ? [operation.bitmap] : [],
        );
        signal?.addEventListener("abort", abort, { once: true });
        if (signal?.aborted) abort();
      } catch {
        pending.delete(id);
        if (operation.kind === "pixels") operation.bitmap.close();
        resolve(null);
      }
    });
  } catch {
    if (operation.kind === "pixels") operation.bitmap.close();
    return Promise.resolve(null);
  }
}
