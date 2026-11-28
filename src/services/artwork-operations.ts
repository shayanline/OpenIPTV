export type ArtworkOperation =
  | {
      kind: "decode";
      blob: Blob;
      width: number;
      height: number;
      fit: boolean;
      dimensions?: { width: number; height: number };
    }
  | { kind: "pixels"; bitmap: ImageBitmap };

export type ArtworkOperationResult = ImageBitmap | Uint8ClampedArray | null;

export function createArtworkProcessor(
  send: (id: number, result: ArtworkOperationResult) => void,
) {
  type Job = { id: number; operation: ArtworkOperation; cancelled: boolean };
  const jobs = new Map<number, Job>();
  const queue: Job[] = [];
  let active = 0;

  const drain = () => {
    while (active < 2 && queue.length) {
      const job = queue.shift()!;
      active += 1;
      void performArtworkOperation(job.operation, () => job.cancelled)
        .catch(() => null)
        .then((result) => {
          jobs.delete(job.id);
          try {
            send(job.id, result);
          } finally {
            active -= 1;
            drain();
          }
        });
    }
  };
  return (message: { id: number; operation?: ArtworkOperation }) => {
    if (!message.operation) {
      const job = jobs.get(message.id);
      if (job) {
        job.cancelled = true;
        const index = queue.indexOf(job);
        if (index >= 0) {
          queue.splice(index, 1);
          jobs.delete(job.id);
          if (job.operation.kind === "pixels") job.operation.bitmap.close();
          send(job.id, null);
        }
      }
      return;
    }
    const job = { id: message.id, operation: message.operation, cancelled: false };
    jobs.set(job.id, job);
    queue.push(job);
    drain();
  };
}

export async function performArtworkOperation(
  operation: ArtworkOperation,
  cancelled: () => boolean = () => false,
): Promise<ArtworkOperationResult> {
  if (operation.kind === "pixels") {
    try {
      if (cancelled()) return null;
      const canvas = new OffscreenCanvas(8, 8);
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) return null;
      context.drawImage(operation.bitmap, 0, 0, 8, 8);
      return context.getImageData(0, 0, 8, 8).data;
    } finally {
      operation.bitmap.close();
    }
  }
  if (cancelled()) return null;
  const { blob, width, height, fit, dimensions } = operation;
  let partial: ImageBitmap | null = null;
  try {
    if (!fit) {
      if (!dimensions) partial = await createImageBitmap(blob);
      if (cancelled()) {
        partial?.close();
        return null;
      }
      if (partial?.width === width && partial.height === height) return partial;
      const source = partial ?? dimensions;
      if (!source) return null;
      const targetRatio = width / height;
      const sourceRatio = source.width / source.height;
      const sourceWidth =
        sourceRatio > targetRatio ? source.height * targetRatio : source.width;
      const sourceHeight =
        sourceRatio > targetRatio ? source.height : source.width / targetRatio;
      const covered = await createImageBitmap(
        partial ?? blob,
        (source.width - sourceWidth) / 2,
        (source.height - sourceHeight) / 2,
        sourceWidth,
        sourceHeight,
        { resizeWidth: width, resizeHeight: height, resizeQuality: "high" },
      );
      partial?.close();
      partial = null;
      if (cancelled()) {
        covered.close();
        return null;
      }
      return covered;
    }
    partial = await createImageBitmap(blob, {
      ...(dimensions && dimensions.width / dimensions.height < width / height
        ? { resizeHeight: height }
        : { resizeWidth: width }),
      resizeQuality: "high",
    });
    if (cancelled()) {
      partial.close();
      return null;
    }
    if (partial.height <= height) return partial;
    const fitted = await createImageBitmap(partial, {
      resizeHeight: height,
      resizeQuality: "high",
    });
    partial.close();
    partial = null;
    if (cancelled()) {
      fitted.close();
      return null;
    }
    return fitted;
  } catch {
    partial?.close();
    return null;
  }
}
