import { execFileSync } from "node:child_process";
import { percentile } from "./measure";
import { writeFileSync } from "node:fs";
import { cpus } from "node:os";

const WARMUP_SAMPLES = 2;
const TIMED_SAMPLES = 7;

/** Describes one deterministic CPU operation in the local baseline matrix. */
export interface OperationSpec {
  /** Stable report label for the operation. */
  readonly name: string;
  /** Human-readable unit for the reported workload count. */
  readonly workloadUnit: string;
  /** Number of units processed by one operation invocation. */
  readonly workloadCount: number;
  /** Optional numeric workload facts that clarify retained versus active size. */
  readonly workloadDetails?: Readonly<Record<string, number>>;
  /** Restores one deterministic precondition outside the timed boundary. */
  readonly beforeEach?: () => void;
  /** Executes one operation without returning a measured value. */
  readonly run: () => void;
}

interface OperationResult {
  readonly name: string;
  readonly workload: {
    readonly unit: string;
    readonly count: number;
    readonly details?: Readonly<Record<string, number>>;
  };
  readonly timingsMs: { readonly p50: number; readonly p95: number };
}

interface OperationsReport {
  readonly schemaVersion: 2;
  readonly kind: "cpu-operation-baseline";
  readonly generatedAt: string;
  readonly gitSha: string;
  /** Whether tracked files were dirty when the report was generated. */
  readonly gitDirty: boolean;
  readonly node: string;
  readonly platform: string;
  readonly arch: string;
  readonly cpuModel: string;
  readonly logicalCores: number;
  readonly warmupSamples: number;
  readonly timedSamples: number;
  readonly measurement: "wall-clock milliseconds; p50/p95 over timed samples";
  readonly operations: readonly OperationResult[];
}

/** Measures the operation matrix and returns one machine-fingerprinted report. */
export function buildOperationsReport(operations: readonly OperationSpec[]): OperationsReport {
  return {
    schemaVersion: 2,
    kind: "cpu-operation-baseline",
    generatedAt: new Date().toISOString(),
    gitSha: gitSha(),
    gitDirty: hasTrackedGitChanges(),
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    cpuModel: cpus()[0]?.model ?? "unknown",
    logicalCores: cpus().length,
    warmupSamples: WARMUP_SAMPLES,
    timedSamples: TIMED_SAMPLES,
    measurement: "wall-clock milliseconds; p50/p95 over timed samples",
    operations: operations.map(measureOperation),
  };
}

/** Writes a report to `PERF_BASELINE_FILE` or stdout when no path is configured. */
export function emitOperationsReport(report: OperationsReport): void {
  const json = `${JSON.stringify(report, undefined, 2)}\n`;
  const path = process.env["PERF_BASELINE_FILE"];
  if (path === undefined || path.length === 0) process.stdout.write(json);
  else writeFileSync(path, json, "utf8");
}

function measureOperation(operation: OperationSpec): OperationResult {
  for (let index = 0; index < WARMUP_SAMPLES; index += 1) {
    operation.beforeEach?.();
    operation.run();
  }
  const samples: number[] = [];
  for (let sample = 0; sample < TIMED_SAMPLES; sample += 1) {
    operation.beforeEach?.();
    const start = performance.now();
    operation.run();
    samples.push(performance.now() - start);
  }
  return {
    name: operation.name,
    workload: {
      unit: operation.workloadUnit,
      count: operation.workloadCount,
      ...(operation.workloadDetails === undefined ? {} : { details: operation.workloadDetails }),
    },
    timingsMs: { p50: percentile(samples, 0.5), p95: percentile(samples, 0.95) },
  };
}

function gitSha(): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function hasTrackedGitChanges(): boolean {
  try {
    return (
      execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=no"], {
        encoding: "utf8",
      }).trim().length > 0
    );
  } catch {
    return false;
  }
}
