import {
  type ArtworkOperation,
  type ArtworkOperationResult,
  createArtworkProcessor,
} from "./artwork-operations";

const scope = self as unknown as {
  onmessage: (event: MessageEvent<{ id: number; operation?: ArtworkOperation }>) => void;
  postMessage: (
    message: { id: number; result: ArtworkOperationResult },
    transfer: Transferable[],
  ) => void;
};
const receive = createArtworkProcessor((id, result) => {
  const transfer =
    result instanceof Uint8ClampedArray
      ? [result.buffer as ArrayBuffer]
      : result
        ? [result]
        : [];
  try {
    scope.postMessage({ id, result }, transfer);
  } catch {
    if (result && !(result instanceof Uint8ClampedArray)) result.close();
    scope.postMessage({ id, result: null }, []);
  }
});

scope.onmessage = ({ data }) => receive(data);
