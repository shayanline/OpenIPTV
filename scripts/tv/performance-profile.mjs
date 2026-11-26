export function selectPerformanceProfile(read, { floor = false, reference = false } = {}) {
  if (floor && reference) {
    throw new Error("--floor and --reference select separate profiles and cannot be combined.");
  }
  if (reference) {
    const base = read("floor.json");
    const faster = read("performance-reference.json");
    return {
      ...faster,
      cpuBenchmarkIndex: Math.round(base.cpuBenchmarkIndex * faster.cpuSpeedup * 100) / 100,
    };
  }
  return read(floor ? "floor.json" : "profile.json");
}
