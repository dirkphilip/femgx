/**
 * Deterministic timing rules shared by the performance budget tests.
 *
 * Deterministic here means fixed workload, fixed warmup, and fixed sample
 * counts; wall-clock variance is absorbed by taking the median and by the
 * generous budget headroom documented in `wiki/engineering/benchmarks.md`.
 */
export const WARMUP_ITERATIONS = 2;
export const SAMPLE_COUNT = 7;

/** Returns the median of a numeric sample set. */
export function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted[middle] ?? 0;
}

/** Returns the nearest-rank percentile of a numeric sample set. */
export function percentile(values: readonly number[], fraction: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1);
  return sorted[index] ?? 0;
}

/** Options for {@link measureMs}; defaults are the documented warmup rules. */
export interface MeasureOptions {
  readonly warmup?: number;
  readonly samples?: number;
  /** How many times `work` runs per timed sample; the result is per iteration. */
  readonly iterations?: number;
}

/** One fixed-size workload in a scaling series. */
export interface ScalingPoint {
  readonly size: number;
  readonly run: () => void;
}

/** One measured point normalized by its declared workload size. */
export interface ScalingMeasurement {
  readonly size: number;
  readonly measuredMs: number;
  readonly millisecondsPerUnit: number;
}

/**
 * Measures `work` after `warmup` untimed runs, then returns the median
 * milliseconds per iteration over `samples` timed samples. Callers must make
 * `work` repeatable (mutating operations must restore their state), otherwise
 * later iterations short-circuit and the measurement is meaningless.
 */
export function measureMs(work: () => void, options: MeasureOptions = {}): number {
  const warmup = options.warmup ?? WARMUP_ITERATIONS;
  const samples = options.samples ?? SAMPLE_COUNT;
  const iterations = options.iterations ?? 1;
  for (let i = 0; i < warmup; i++) {
    work();
  }
  const timings: number[] = [];
  for (let sample = 0; sample < samples; sample++) {
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      work();
    }
    timings.push((performance.now() - start) / iterations);
  }
  return median(timings);
}

/** Measures fixed-size points with the lighter sampling appropriate for scaling ratios. */
export function measureScaling(
  points: readonly ScalingPoint[],
  options: MeasureOptions = { warmup: 1, samples: 3 },
): readonly ScalingMeasurement[] {
  return points.map(({ size, run }) => {
    if (!Number.isFinite(size) || size <= 0) throw new Error("Scaling size must be positive");
    const measuredMs = measureMs(run, options);
    return { size, measuredMs, millisecondsPerUnit: measuredMs / size };
  });
}
