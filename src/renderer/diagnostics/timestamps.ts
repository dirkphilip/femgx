import { GPU_COST_PASSES, type GpuCostPass } from "./cost";

const TIMESTAMP_QUERY_COUNT = GPU_COST_PASSES.length * 2;
const READBACK_POOL_SIZE = 3;
const TIMESTAMP_BYTES = TIMESTAMP_QUERY_COUNT * BigUint64Array.BYTES_PER_ELEMENT;
const DISJOINT_TIMESTAMP = 0xffffffffffffffffn;

export interface GpuTimestampPassTiming {
  readonly sampleCount: number;
  readonly p50: number | null;
  readonly p95: number | null;
  readonly p99: number | null;
  readonly invalidSampleCount: number;
  readonly disjointSampleCount: number;
}

/** Snapshot of optional, benchmark-only pass timestamps. */
export interface GpuTimestampSnapshot {
  readonly available: boolean;
  readonly enabled: boolean;
  readonly unit: "nanoseconds" | "timestamp-ticks" | "none";
  readonly periodNs: number | null;
  readonly sampleCount: number;
  readonly invalidSampleCount: number;
  /** WebGPU exposes no separate disjoint flag; sentinel results are counted here. */
  readonly disjointSampleCount: number;
  readonly passes: Readonly<Record<GpuCostPass, GpuTimestampPassTiming>>;
}

/** A frame's timestamp writes, kept internal to renderer command encoding. */
export interface GpuTimestampFrame {
  readonly writes: (pass: GpuCostPass) => GPURenderPassTimestampWrites;
  readonly passes: ReadonlySet<GpuCostPass>;
}

interface TimestampSlot {
  readonly resolveBuffer: GPUBuffer;
  readonly readbackBuffer: GPUBuffer;
  state: "free" | "recording" | "pending" | "mapping";
  submittedFrame: number;
  mapPromise: Promise<void> | undefined;
  activePasses: ReadonlySet<GpuCostPass> | undefined;
}

interface TimestampSample {
  readonly values: Partial<Record<GpuCostPass, number>>;
  readonly invalid: Partial<Record<GpuCostPass, boolean>>;
  readonly disjoint: Partial<Record<GpuCostPass, boolean>>;
  readonly invalidFrame: boolean;
  readonly disjointFrame: boolean;
}

/**
 * Owns a bounded timestamp query and delayed readback pool for one benchmark.
 * Mapping is only started after two later encoded frames have advanced.
 */
export class GpuTimestampRecorder {
  private readonly querySet: GPUQuerySet;
  private readonly slots: TimestampSlot[];
  private readonly values = emptySampleValues();
  private readonly invalid = emptySampleCounts();
  private readonly disjoint = emptySampleCounts();
  private frameNumber = 0;
  private resolvedSampleCount = 0;
  private invalidSampleCount = 0;
  private disjointSampleCount = 0;
  private destroyed = false;

  public constructor(
    private readonly device: GPUDevice,
    private readonly periodNs: number | undefined,
  ) {
    this.querySet = device.createQuerySet({
      label: "femgx benchmark pass timestamps",
      type: "timestamp",
      count: TIMESTAMP_QUERY_COUNT,
    });
    this.slots = Array.from({ length: READBACK_POOL_SIZE }, (_, index) => ({
      resolveBuffer: device.createBuffer({
        label: `femgx benchmark timestamp resolve ${index}`,
        size: TIMESTAMP_BYTES,
        usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
      }),
      readbackBuffer: device.createBuffer({
        label: `femgx benchmark timestamp readback ${index}`,
        size: TIMESTAMP_BYTES,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      }),
      state: "free",
      submittedFrame: 0,
      mapPromise: undefined,
      activePasses: undefined,
    }));
  }

  /** Begins one command submission's bounded pass timestamp set. */
  public beginFrame(): GpuTimestampFrame | undefined {
    this.ensureAlive();
    this.frameNumber += 1;
    this.poll();
    const slot = this.slots.find((candidate) => candidate.state === "free");
    if (slot === undefined) return undefined;
    slot.state = "recording";
    slot.submittedFrame = this.frameNumber;
    const activePasses = new Set<GpuCostPass>();
    slot.activePasses = activePasses;
    return {
      passes: activePasses,
      writes: (pass) => {
        const passIndex = GPU_COST_PASSES.indexOf(pass);
        if (passIndex < 0) throw new Error(`Unknown GPU timestamp pass: ${pass}`);
        activePasses.add(pass);
        return {
          querySet: this.querySet,
          beginningOfPassWriteIndex: passIndex * 2,
          endOfPassWriteIndex: passIndex * 2 + 1,
        };
      },
    };
  }

  /** Resolves one frame exactly once, before its command buffer is submitted. */
  public resolve(encoder: GPUCommandEncoder, frame: GpuTimestampFrame): void {
    this.ensureAlive();
    const slot = this.slots.find(
      (candidate) =>
        candidate.state === "recording" && candidate.submittedFrame === this.frameNumber,
    );
    if (slot === undefined) throw new Error("GPU timestamp frame is no longer recording");
    if (slot.activePasses !== frame.passes) {
      throw new Error("GPU timestamp frame does not belong to the active query slot");
    }
    encoder.resolveQuerySet(this.querySet, 0, TIMESTAMP_QUERY_COUNT, slot.resolveBuffer, 0);
    encoder.copyBufferToBuffer(slot.resolveBuffer, 0, slot.readbackBuffer, 0, TIMESTAMP_BYTES);
    slot.state = "pending";
  }

  /** Starts delayed readback without awaiting or mapping the current frame. */
  public poll(): void {
    if (this.destroyed) return;
    for (const slot of this.slots) {
      if (slot.state !== "pending" || this.frameNumber - slot.submittedFrame < 2) continue;
      slot.state = "mapping";
      slot.mapPromise = this.mapSlot(slot);
    }
  }

  /** Finishes benchmark-only delayed readback after the measured work. */
  public async drain(): Promise<void> {
    if (this.destroyed) return;
    await this.device.queue.onSubmittedWorkDone();
    this.frameNumber += 2;
    this.poll();
    await Promise.all(
      this.slots.flatMap((slot) => (slot.mapPromise === undefined ? [] : [slot.mapPromise])),
    );
  }

  /** Returns detached pass percentiles and honest feature/error accounting. */
  public snapshot(): GpuTimestampSnapshot {
    return {
      available: true,
      enabled: true,
      unit: this.periodNs === undefined ? "timestamp-ticks" : "nanoseconds",
      periodNs: this.periodNs ?? null,
      sampleCount: this.resolvedSampleCount,
      invalidSampleCount: this.invalidSampleCount,
      disjointSampleCount: this.disjointSampleCount,
      passes: passRecord((pass) => {
        const samples = this.values[pass];
        return {
          sampleCount: samples.length,
          p50: percentile(samples, 0.5),
          p95: percentile(samples, 0.95),
          p99: percentile(samples, 0.99),
          invalidSampleCount: this.invalid[pass],
          disjointSampleCount: this.disjoint[pass],
        };
      }),
    };
  }

  /** Releases query and readback resources, including during recovery teardown. */
  public destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.querySet.destroy();
    for (const slot of this.slots) {
      slot.resolveBuffer.destroy();
      slot.readbackBuffer.destroy();
    }
  }

  private async mapSlot(slot: TimestampSlot): Promise<void> {
    try {
      await slot.readbackBuffer.mapAsync(GPUMapMode.READ);
      const timestamps = new BigUint64Array(slot.readbackBuffer.getMappedRange());
      const sample = decodeSample(timestamps, this.periodNs, slot.activePasses ?? new Set());
      this.record(sample);
      slot.readbackBuffer.unmap();
    } catch {
      this.invalidSampleCount += 1;
    } finally {
      slot.state = "free";
      slot.mapPromise = undefined;
      slot.activePasses = undefined;
    }
  }

  private record(sample: TimestampSample): void {
    this.resolvedSampleCount += 1;
    if (sample.invalidFrame) this.invalidSampleCount += 1;
    if (sample.disjointFrame) this.disjointSampleCount += 1;
    for (const pass of GPU_COST_PASSES) {
      if (sample.invalid[pass] === true) this.invalid[pass] += 1;
      if (sample.disjoint[pass] === true) this.disjoint[pass] += 1;
      const value = sample.values[pass];
      if (value !== undefined) this.values[pass].push(value);
    }
  }

  private ensureAlive(): void {
    if (this.destroyed) throw new Error("GPU timestamp recorder has been destroyed");
  }
}

/** Creates timestamps only when the benchmark explicitly requested the feature. */
export function createGpuTimestampRecorder(
  device: GPUDevice,
  requested: boolean,
): GpuTimestampRecorder | undefined {
  if (!requested || !device.features.has("timestamp-query")) return undefined;
  try {
    return new GpuTimestampRecorder(device, timestampPeriodNs(device));
  } catch {
    return undefined;
  }
}

/** Returns a stable unavailable shape without changing ordinary cost accounting. */
export function unavailableGpuTimestampSnapshot(): GpuTimestampSnapshot {
  return {
    available: false,
    enabled: false,
    unit: "none",
    periodNs: null,
    sampleCount: 0,
    invalidSampleCount: 0,
    disjointSampleCount: 0,
    passes: passRecord(() => emptyPassTiming()),
  };
}

function decodeSample(
  timestamps: BigUint64Array,
  periodNs: number | undefined,
  activePasses: ReadonlySet<GpuCostPass>,
): TimestampSample {
  const values: Partial<Record<GpuCostPass, number>> = {};
  const invalid: Partial<Record<GpuCostPass, boolean>> = {};
  const disjoint: Partial<Record<GpuCostPass, boolean>> = {};
  let invalidFrame = false;
  let disjointFrame = false;
  for (const [index, pass] of GPU_COST_PASSES.entries()) {
    if (!activePasses.has(pass)) continue;
    const start = timestamps[index * 2] ?? 0n;
    const end = timestamps[index * 2 + 1] ?? 0n;
    if (start === DISJOINT_TIMESTAMP || end === DISJOINT_TIMESTAMP) {
      invalid[pass] = true;
      disjoint[pass] = true;
      invalidFrame = true;
      disjointFrame = true;
      continue;
    }
    if (end < start) {
      invalid[pass] = true;
      invalidFrame = true;
      continue;
    }
    const ticks = Number(end - start);
    const value = periodNs === undefined ? ticks : ticks * periodNs;
    if (!Number.isFinite(value)) {
      invalid[pass] = true;
      invalidFrame = true;
      continue;
    }
    values[pass] = value;
  }
  return { values, invalid, disjoint, invalidFrame, disjointFrame };
}

function timestampPeriodNs(device: GPUDevice): number | undefined {
  const period = (device.limits as GPUSupportedLimits & { timestampPeriod?: number })
    .timestampPeriod;
  return period !== undefined && Number.isFinite(period) && period > 0 ? period : undefined;
}

function emptySampleValues(): Record<GpuCostPass, number[]> {
  return passRecord(() => []);
}

function emptySampleCounts(): Record<GpuCostPass, number> {
  return passRecord(() => 0);
}

function passRecord<T>(factory: (pass: GpuCostPass) => T): Record<GpuCostPass, T> {
  return {
    opaque: factory("opaque"),
    transparency: factory("transparency"),
    composite: factory("composite"),
    pick: factory("pick"),
  };
}

function emptyPassTiming(): GpuTimestampPassTiming {
  return {
    sampleCount: 0,
    p50: null,
    p95: null,
    p99: null,
    invalidSampleCount: 0,
    disjointSampleCount: 0,
  };
}

function percentile(values: readonly number[], fraction: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(fraction * sorted.length) - 1] ?? null;
}
