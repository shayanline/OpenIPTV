import "./support/browserEvents";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";
import {
  type ArtworkOperation,
  type ArtworkOperationResult,
  createArtworkProcessor,
} from "../src/services/artwork-operations";

vi.mock("../src/services/artwork-worker?worker", () => ({
  default: class {
    onmessage:
      | ((event: { data: { id: number; result: ArtworkOperationResult } }) => void)
      | null = null;
    private terminated = false;
    private readonly ids = new Set<number>();
    private readonly receive = createArtworkProcessor((id, result) => {
      this.ids.delete(id);
      if (this.terminated) {
        if (result && !(result instanceof Uint8ClampedArray)) result.close();
      } else this.onmessage?.({ data: { id, result } });
    });
    postMessage(message: { id: number; operation?: ArtworkOperation }) {
      this.ids.add(message.id);
      this.receive(message);
    }
    terminate() {
      this.terminated = true;
      for (const id of this.ids) this.receive({ id });
    }
  },
}));

afterEach(cleanup);

/**
 * The handful of browser APIs jsdom does not implement.
 *
 * Each is stubbed rather than emulated. Nothing here is under test: they exist so that a
 * component which observes its own size, or asks to be scrolled into view, can be mounted at
 * all. jsdom has no layout engine, so a faithful implementation is not available in any case.
 */

if (!("ResizeObserver" in globalThis)) {
  // The app measures the panel to decide how many rows fit. With no layout there is nothing
  // to report, and the hook already copes with a height of zero by claiming one row.
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

if (!("IntersectionObserver" in globalThis)) {
  Object.defineProperty(globalThis, "IntersectionObserver", {
    configurable: true,
    writable: true,
    value: class {
      constructor(
        private readonly callback: (
          entries: Array<
            Pick<IntersectionObserverEntry, "target" | "isIntersecting" | "intersectionRatio">
          >,
        ) => void,
      ) {}
      observe(target: Element) {
        void Promise.resolve().then(() =>
          this.callback([{ target, isIntersecting: true, intersectionRatio: 1 }]),
        );
      }
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    },
  });
}

if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

if (!Element.prototype.animate) {
  // Only cancellation is modeled. Tests that need animation completion supply their own stub.
  Element.prototype.animate = () => {
    const animation = {
      playState: "running",
      onfinish: null,
      cancel() {
        this.playState = "idle";
      },
    };
    return animation as unknown as Animation;
  };
}

if (!Element.prototype.setPointerCapture) {
  // The on-screen pad drags with pointer capture. jsdom has no capture to take.
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
}

// createImageBitmap is used to shrink logos. Nothing in the tests draws one, and the logo
// cache has its own tests where this is stubbed deliberately.
if (!("createImageBitmap" in globalThis)) {
  globalThis.createImageBitmap = (() =>
    Promise.reject(new Error("no decoder in jsdom"))) as unknown as typeof createImageBitmap;
}

if (!("OffscreenCanvas" in globalThis)) {
  globalThis.OffscreenCanvas = class {
    private readonly canvas = document.createElement("canvas");
    constructor(width: number, height: number) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    getContext(_kind: "2d", options?: CanvasRenderingContext2DSettings) {
      return this.canvas.getContext("2d", options);
    }
  } as unknown as typeof OffscreenCanvas;
}

if (typeof window.matchMedia !== "function") {
  // Motion preference queries get a quiet answer: no reduced motion, and listeners that
  // never fire. Tests that care stub their own.
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addListener() {},
        removeListener() {},
        addEventListener() {},
        removeEventListener() {},
        dispatchEvent() {
          return true;
        },
      }) as unknown as MediaQueryList,
  });
}

globalThis.matchMedia = window.matchMedia;
