import type { BenchmarkPercentiles } from "./types";

/** Computes benchmark p50 and p95 values with the shared sample convention. */
export function percentiles(values: readonly number[]): BenchmarkPercentiles {
  const sorted = [...values].sort((left, right) => left - right);
  const at = (fraction: number): number => sorted[Math.ceil(sorted.length * fraction) - 1] ?? 0;
  return { p50: at(0.5), p95: at(0.95) };
}
