import { afterEach, expect, test, vi } from "vitest";
import {
  type ArtworkOperation,
  type ArtworkOperationResult,
  createArtworkProcessor,
} from "../src/services/artwork-operations";

const image = (width = 192, height = 288) =>
  ({ width, height, close: vi.fn() }) as unknown as ImageBitmap;
const decode: ArtworkOperation = {
  kind: "decode",
  blob: new Blob(["image"]),
  width: 192,
  height: 288,
  fit: false,
};

afterEach(() => vi.unstubAllGlobals());

test("the worker bounds concurrent operations and closes a cancelled queued palette clone", async () => {
  const finish: Array<(bitmap: ImageBitmap) => void> = [];
  const native = vi.fn(() => new Promise<ImageBitmap>((resolve) => finish.push(resolve)));
  vi.stubGlobal("createImageBitmap", native);
  const replies = new Map<number, ArtworkOperationResult>();
  const receive = createArtworkProcessor((id, result) => replies.set(id, result));
  const clone = image();
  receive({ id: 1, operation: decode });
  receive({ id: 2, operation: decode });
  receive({ id: 3, operation: { kind: "pixels", bitmap: clone } });
  expect(native).toHaveBeenCalledTimes(2);
  expect(clone.close).not.toHaveBeenCalled();
  receive({ id: 3 });
  expect(clone.close).toHaveBeenCalledTimes(1);
  expect(replies.get(3)).toBeNull();
  expect(replies.size).toBe(1);
  const first = image();
  const second = image();
  finish[0](first);
  finish[1](second);
  await vi.waitFor(() => expect(replies.size).toBe(3));
  expect(replies.get(3)).toBeNull();
  expect(clone.close).toHaveBeenCalledTimes(1);
  expect(first.close).not.toHaveBeenCalled();
  expect(second.close).not.toHaveBeenCalled();
  first.close();
  second.close();
});

test("cancelling an active decode closes its source without starting normalization", async () => {
  let finish!: (bitmap: ImageBitmap) => void;
  const native = vi.fn(() => new Promise<ImageBitmap>((resolve) => (finish = resolve)));
  vi.stubGlobal("createImageBitmap", native);
  const send = vi.fn();
  const receive = createArtworkProcessor(send);
  receive({ id: 1, operation: decode });
  receive({ id: 1 });
  const source = image(16, 24);
  finish(source);
  await vi.waitFor(() => expect(send).toHaveBeenCalledWith(1, null));
  expect(native).toHaveBeenCalledTimes(1);
  expect(source.close).toHaveBeenCalledTimes(1);
});
