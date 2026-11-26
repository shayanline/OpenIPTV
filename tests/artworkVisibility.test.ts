import { afterEach, expect, test, vi } from "vitest";

afterEach(() => vi.unstubAllGlobals());

async function setup() {
  vi.resetModules();
  const instances: Array<{
    deliver: (entries: Partial<IntersectionObserverEntry>[]) => void;
    observe: ReturnType<typeof vi.fn>;
    unobserve: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
  }> = [];
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
      constructor(callback: IntersectionObserverCallback) {
        instances.push({
          deliver: (entries) =>
            callback(
              entries as IntersectionObserverEntry[],
              this as unknown as IntersectionObserver,
            ),
          observe: this.observe,
          unobserve: this.unobserve,
          disconnect: this.disconnect,
        });
      }
    },
  );
  const { observeArtworkVisibility } = await import("../src/services/artworkVisibility");
  return { observeArtworkVisibility, instances };
}

test("artwork shares visibility observation while retaining independent ownership", async () => {
  const { observeArtworkVisibility, instances } = await setup();
  const first = document.createElement("span");
  const second = document.createElement("canvas");
  const firstVisible = vi.fn();
  const secondVisible = vi.fn();
  const stopFirst = observeArtworkVisibility(first, firstVisible);
  const stopSecond = observeArtworkVisibility(second, secondVisible);
  expect(instances).toHaveLength(1);
  const observer = instances[0];
  observer.deliver([
    { target: first, isIntersecting: true, intersectionRatio: 1 },
    { target: second, isIntersecting: true, intersectionRatio: 0 },
  ]);
  expect(firstVisible).toHaveBeenLastCalledWith(true);
  expect(secondVisible).toHaveBeenLastCalledWith(false);
  stopFirst();
  expect(observer.unobserve).toHaveBeenCalledWith(first);
  expect(observer.disconnect).not.toHaveBeenCalled();
  firstVisible.mockClear();
  observer.deliver([
    { target: first, isIntersecting: false, intersectionRatio: 0 },
    { target: second, isIntersecting: true, intersectionRatio: 0.5 },
  ]);
  expect(firstVisible).not.toHaveBeenCalled();
  expect(secondVisible).toHaveBeenLastCalledWith(true);
  stopFirst();
  stopSecond();
  expect(observer.disconnect).toHaveBeenCalledOnce();
});

test("retired visibility observers cannot publish into a new artwork owner", async () => {
  const { observeArtworkVisibility, instances } = await setup();
  const element = document.createElement("span");
  const previous = vi.fn();
  const current = vi.fn();
  const stopPrevious = observeArtworkVisibility(element, previous);
  stopPrevious();
  const stopCurrent = observeArtworkVisibility(element, current);
  instances[0].deliver([{ target: element, isIntersecting: true, intersectionRatio: 1 }]);
  expect(current).not.toHaveBeenCalled();
  instances[1].deliver([{ target: element, isIntersecting: true, intersectionRatio: 1 }]);
  expect(current).toHaveBeenCalledWith(true);
  stopCurrent();
});
