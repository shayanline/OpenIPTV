/**
 * Do something in whatever time is going spare, and be able to call it off.
 *
 * Shared because three things want it and they wanted it for the same reason: warming logos
 * ahead of a category, refreshing a playlist behind the picture, and collecting cached
 * copies of playlists nobody watches. All three are work that must never be the reason a key
 * press waits, and all three have to be cancellable, because all three belong to a state the
 * viewer may have left.
 *
 * The canceller remembers which kind of handle it made rather than trying both. An idle
 * callback id and a timeout id are separate numeric namespaces, so clearing one by the
 * other's number cancels whichever unrelated timer happens to share that number, and this
 * application keeps several live at once. That is not hypothetical: it is written up at
 * warmChain in services/logos, where it was found.
 */
export function whenIdle(work: () => void, timeout: number): () => void {
  if (window.requestIdleCallback) {
    const id = window.requestIdleCallback(work, { timeout });
    return () => window.cancelIdleCallback(id);
  }
  /* No requestIdleCallback, which is Safari and jsdom rather than any television: Samsung's
     engines have had it since long before 2020. Capped, because the timeout is the deadline
     by which idle work must happen anyway rather than how long to wait before starting. */
  const id = window.setTimeout(work, Math.min(timeout, 500));
  return () => window.clearTimeout(id);
}
