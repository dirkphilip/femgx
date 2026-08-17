import type { measureScaling, ScalingPoint } from "../measure";

export interface BudgetCase {
  readonly name: string;
  readonly description: string;
  readonly budgetMs: number;
  readonly run: () => void;
}

export interface ScalingCase {
  readonly name: string;
  readonly description: string;
  readonly points: readonly ScalingPoint[];
  /** Maximum tolerated spread between the cheapest and costliest normalized points. */
  readonly maxNormalizedSpread: number;
  readonly iterations?: number;
}

/** Prints one optional human-readable wall-clock measurement. */
export function report(name: string, description: string, measuredMs: number): void {
  if (process.env["PERF_REPORT"] === undefined) return;
  console.log(`${name.padEnd(38)} ${description.padEnd(46)} ${measuredMs.toFixed(3)} ms`);
}

/** Prints optional per-size scaling measurements. */
export function reportScaling(name: string, measurements: ReturnType<typeof measureScaling>): void {
  if (process.env["PERF_REPORT"] === undefined) return;
  console.log(
    `${name}: ${measurements
      .map(({ size, measuredMs }) => `${size}=${measuredMs.toFixed(3)} ms`)
      .join(", ")}`,
  );
}
