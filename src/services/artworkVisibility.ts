type VisibilityListener = (visible: boolean) => void;

let observer: IntersectionObserver | null = null;
const listeners = new Map<Element, VisibilityListener>();

export function observeArtworkVisibility(
  element: Element,
  listener: VisibilityListener,
): () => void {
  if (!observer) {
    const current = new IntersectionObserver(
      (entries) => {
        if (observer !== current) return;
        for (const entry of entries) {
          listeners.get(entry.target)?.(entry.isIntersecting && entry.intersectionRatio > 0);
        }
      },
      { threshold: [0, 0.01] },
    );
    observer = current;
  }
  const current = observer;
  listeners.set(element, listener);
  current.observe(element);

  return () => {
    if (listeners.get(element) !== listener) return;
    listeners.delete(element);
    current.unobserve(element);
    if (!listeners.size) {
      current.disconnect();
      observer = null;
    }
  };
}
