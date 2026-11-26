// Copyright 2024 The Chromium Authors
// BSD license and source attribution are in benchmark-index.LICENSE.

export function computeBenchmarkIndex(duration = 250) {
  const halfTime = duration / 2;

  function benchmarkIndexGC() {
    const start = Date.now();
    let iterations = 0;
    while (Date.now() - start < halfTime) {
      let s = "";
      for (let j = 0; j < 10000; j++) s += "a";
      if (s.length === 1) {
        throw new Error("will never happen, but prevents compiler optimizations");
      }
      iterations++;
    }
    const durationInSeconds = (Date.now() - start) / 1000;
    return Math.round(iterations / 10 / durationInSeconds);
  }

  function benchmarkIndexNoGC() {
    const arrA = [];
    const arrB = [];
    for (let i = 0; i < 100000; i++) arrA[i] = arrB[i] = i;
    const start = Date.now();
    let iterations = 0;
    // Checking every tenth copy avoids an instruction alignment cliff on some Intel CPUs.
    while (iterations % 10 !== 0 || Date.now() - start < halfTime) {
      const src = iterations % 2 === 0 ? arrA : arrB;
      const tgt = iterations % 2 === 0 ? arrB : arrA;
      for (let j = 0; j < src.length; j++) tgt[j] = src[j];
      iterations++;
    }
    const durationInSeconds = (Date.now() - start) / 1000;
    return Math.round(iterations / 10 / durationInSeconds);
  }

  return (benchmarkIndexGC() + benchmarkIndexNoGC()) / 2;
}
