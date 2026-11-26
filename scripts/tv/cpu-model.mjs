const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const rateOf = (value) => Math.round(Math.max(1, value) * 100) / 100;
export const CPU_TOLERANCE = 0.05;

export function cpuControl(scores, targetScore, tolerance = CPU_TOLERANCE) {
  if (!scores.length || scores.some((score) => !Number.isFinite(score) || score <= 0)) {
    throw new Error("CPU control requires finite positive workload scores.");
  }
  const achievedScore = median(scores);
  return {
    achievedScore,
    tolerance,
    matches: Math.abs(achievedScore / targetScore - 1) <= tolerance,
    spread: (Math.max(...scores) - Math.min(...scores)) / achievedScore,
  };
}

/**
 * Match a workload score, not a multiplier tied to a particular developer's laptop.
 * sample applies a CDP rate and returns a BenchmarkIndex from the same renderer.
 */
export async function calibrateCpu(sample, targetScore, { tolerance = CPU_TOLERANCE } = {}) {
  if (!Number.isFinite(targetScore) || targetScore <= 0) {
    throw new Error("The CPU target score must be positive and finite.");
  }
  const measure = async (rate) => {
    const score = await sample(rate);
    if (!Number.isFinite(score) || score <= 0) {
      throw new Error(`Invalid CPU calibration score at ${rate}x: ${score}`);
    }
    return score;
  };

  await measure(1); // Warm V8 before measuring the host.
  const baselineScore = median([await measure(1), await measure(1), await measure(1)]);
  if (baselineScore < targetScore * (1 - tolerance)) {
    throw new Error(
      `This renderer scores ${baselineScore}, below the CPU target ${targetScore}. ` +
        "CPU throttling cannot make it faster.",
    );
  }

  let lower = 1;
  let upper = rateOf(Math.min(128, Math.max(2, (baselineScore / targetScore) * 1.5)));
  let best = { rate: 1, score: baselineScore };
  const consider = async (rate) => {
    const score = median([await measure(rate), await measure(rate), await measure(rate)]);
    if (Math.abs(score - targetScore) < Math.abs(best.score - targetScore)) {
      best = { rate, score };
    }
    return score;
  };
  let upperScore = await consider(upper);
  while (upperScore > targetScore && upper < 128) {
    lower = upper;
    upper = rateOf(Math.min(128, upper * 2));
    upperScore = await consider(upper);
  }
  for (let attempt = 0; attempt < 10; attempt++) {
    if (Math.abs(best.score / targetScore - 1) <= Math.min(0.01, tolerance / 2)) break;
    const rate = rateOf((lower + upper) / 2);
    if (rate === lower || rate === upper) break;
    if ((await consider(rate)) > targetScore) lower = rate;
    else upper = rate;
  }

  const checks = [];
  for (let index = 0; index < 5; index++) checks.push(await measure(best.rate));
  const achievedScore = median(checks);
  const error = Math.abs(achievedScore / targetScore - 1);
  if (error > tolerance) {
    throw new Error(
      `CPU calibration reached ${achievedScore}, outside ${tolerance * 100}% of ` +
        `the ${targetScore} target. No performance result was measured.`,
    );
  }
  return {
    rate: best.rate,
    targetScore,
    baselineScore,
    achievedScore,
    tolerance,
    spread: (Math.max(...checks) - Math.min(...checks)) / achievedScore,
  };
}
