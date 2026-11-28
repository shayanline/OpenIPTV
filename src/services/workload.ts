export interface ArtworkWorkload {
  loads: number;
  decodes: number;
  prefetch: number;
}

export interface WorkloadHints {
  cores?: number;
  memoryGB?: number;
}

export function createArtworkWorkload(
  hints: WorkloadHints = {},
  changed: () => void = () => {},
) {
  const memory =
    Number.isFinite(hints.memoryGB) && (hints.memoryGB ?? 0) > 0 ? hints.memoryGB : undefined;
  const maximum: ArtworkWorkload = {
    loads: memory === undefined || memory > 2 ? 18 : memory > 1 ? 12 : 6,
    decodes: memory !== undefined && memory <= 1 ? 1 : 2,
    prefetch: memory === undefined || memory > 2 ? 4 : memory > 1 ? 2 : 1,
  };
  const cores = Number.isFinite(hints.cores) ? (hints.cores ?? 0) : 0;
  let limits: Readonly<ArtworkWorkload> = {
    loads: Math.min(maximum.loads, cores >= 8 ? 8 : 4),
    decodes: 1,
    prefetch: 1,
  };
  let healthyFrames = 0;
  let fastDecodes = 0;
  let completedLoads = 0;
  let firstLoadAt: number | null = null;
  let lastLoadAt = 0;
  let previousThroughput: number | null = null;
  let changeAfter = 0;

  const publish = (next: ArtworkWorkload) => {
    if (
      next.loads === limits.loads &&
      next.decodes === limits.decodes &&
      next.prefetch === limits.prefetch
    )
      return;
    limits = next;
    changed();
  };
  const resetLoads = () => {
    completedLoads = 0;
    firstLoadAt = null;
    lastLoadAt = 0;
  };
  const grow = (now: number) => {
    if (now < changeAfter || healthyFrames < 8) return;
    const loadWindowReady = completedLoads >= 4 && firstLoadAt !== null;
    if (!loadWindowReady && (fastDecodes < 8 || limits.decodes === maximum.decodes)) return;
    const next = { ...limits };
    let usefulThroughput = false;
    if (loadWindowReady && firstLoadAt !== null) {
      const throughput = completedLoads / Math.max(1, lastLoadAt - firstLoadAt);
      usefulThroughput = previousThroughput === null || throughput >= previousThroughput * 0.75;
      next.loads = usefulThroughput
        ? Math.min(maximum.loads, limits.loads + 2)
        : Math.max(2, limits.loads - 1);
      previousThroughput =
        previousThroughput === null ? throughput : (previousThroughput + throughput) / 2;
      resetLoads();
    }
    if (fastDecodes >= 8) next.decodes = Math.min(maximum.decodes, limits.decodes + 1);
    if (usefulThroughput && fastDecodes >= 4) {
      next.prefetch = Math.min(maximum.prefetch, limits.prefetch + 1);
    }
    changeAfter = now + 1000;
    healthyFrames = 0;
    fastDecodes = 0;
    publish(next);
  };

  return {
    limits: () => limits,
    frame: (duration: number, now: number) => {
      if (duration > 50) {
        healthyFrames = 0;
        fastDecodes = 0;
        previousThroughput = null;
        resetLoads();
        changeAfter = now + 3000;
        publish({
          loads: Math.max(2, Math.floor(limits.loads / 2)),
          decodes: 1,
          prefetch: 1,
        });
        return;
      }
      healthyFrames = duration > 0 && duration <= 24 ? Math.min(60, healthyFrames + 1) : 0;
      grow(now);
    },
    decoded: (duration: number, now: number) => {
      fastDecodes = duration >= 0 && duration <= 40 ? Math.min(16, fastDecodes + 1) : 0;
      grow(now);
    },
    completed: (startedAt: number, now: number) => {
      completedLoads += 1;
      firstLoadAt = firstLoadAt === null ? startedAt : Math.min(firstLoadAt, startedAt);
      lastLoadAt = Math.max(lastLoadAt, now);
      grow(now);
    },
  };
}

const listeners = new Set<() => void>();
const policy = createArtworkWorkload(
  typeof navigator === "undefined"
    ? {}
    : {
        cores: navigator.hardwareConcurrency,
        memoryGB: (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
      },
  () => {
    for (const listener of listeners) listener();
  },
);

export const artworkWorkload = () => policy.limits();

export function observeArtworkWorkload(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const recordArtworkDecode = (duration: number) =>
  policy.decoded(duration, performance.now());

export const recordArtworkLoad = (startedAt: number) =>
  policy.completed(startedAt, performance.now());

let activeWork = 0;
let frame = 0;
let previousFrame = 0;
const resetFrameClock = () => {
  previousFrame = 0;
};
const sampleFrame = (now: number) => {
  frame = 0;
  if (!activeWork) return;
  if (!document.hidden) {
    if (previousFrame) policy.frame(now - previousFrame, now);
    previousFrame = now;
  } else {
    resetFrameClock();
  }
  if (activeWork) frame = window.requestAnimationFrame(sampleFrame);
};

// Sampling ends with the last owned image attempt, including cancelled decoder work.
export function trackArtworkWork(): () => void {
  activeWork += 1;
  if (activeWork === 1) {
    resetFrameClock();
    document.addEventListener("visibilitychange", resetFrameClock);
    frame = window.requestAnimationFrame(sampleFrame);
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeWork -= 1;
    if (activeWork) return;
    window.cancelAnimationFrame(frame);
    frame = 0;
    resetFrameClock();
    document.removeEventListener("visibilitychange", resetFrameClock);
  };
}
