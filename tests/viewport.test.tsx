import { act, cleanup, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { useViewport } from "../src/hooks/useViewport";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test("content box resize deliveries update height without reading layout again", () => {
  let deliver: ResizeObserverCallback;
  const disconnect = vi.fn();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: ResizeObserverCallback) {
        deliver = callback;
      }
      observe() {}
      disconnect = disconnect;
    },
  );
  const height = vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(500);
  function Probe() {
    const ref = useRef<HTMLDivElement>(null);
    const measured = useViewport(ref, true);
    return <div ref={ref} data-height={measured} style={{ padding: "20px 0" }} />;
  }
  const view = render(<Probe />);
  const element = view.container.firstElementChild as HTMLElement;
  expect(element.dataset.height).toBe("460");
  height.mockClear();
  const style = vi.spyOn(window, "getComputedStyle");
  act(() => {
    deliver(
      [{ target: element, contentRect: { height: 350.5 } } as ResizeObserverEntry],
      {} as ResizeObserver,
    );
  });
  expect(element.dataset.height).toBe("350.5");
  expect(style).not.toHaveBeenCalled();
  expect(height).not.toHaveBeenCalled();
  view.unmount();
  expect(disconnect).toHaveBeenCalledOnce();
});
