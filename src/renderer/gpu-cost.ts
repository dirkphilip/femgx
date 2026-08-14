/** Passes encoded by one visible frame or a pick snapshot. */
export const GPU_COST_PASSES = ["opaque", "transparency", "composite", "pick"] as const;
export type GpuCostPass = (typeof GPU_COST_PASSES)[number];

/** Draw categories used to separate renderer features in a frame cost. */
export const GPU_COST_DRAWS = [
  "background",
  "opaque",
  "point-replay",
  "selection-visible",
  "selection-hidden",
  "transparency",
  "composite",
  "edges",
  "nodes",
  "vector-glyph",
  "origin-triad",
  "pivot",
  "pick",
] as const;
export type GpuCostDraw = (typeof GPU_COST_DRAWS)[number];

/** GPU buffer write categories retained by the internal cost model. */
export const GPU_COST_WRITES = [
  "instance",
  "highlight",
  "order",
  "deformation",
  "result",
  "vector-glyph",
  "uniform",
  "geometry",
  "other",
] as const;
export type GpuCostWrite = (typeof GPU_COST_WRITES)[number];

/** CPU submission work counted by the internal cost model. */
export const GPU_COST_CPU = ["instance-scan", "order-rebuild", "call-rebuild"] as const;
export type GpuCostCpu = (typeof GPU_COST_CPU)[number];

export interface GpuDrawCost {
  readonly calls: number;
  readonly indices: number;
  readonly instances: number;
}

export interface GpuWriteCost {
  readonly calls: number;
  readonly bytes: number;
}

export interface GpuTargetCost {
  readonly width: number;
  readonly height: number;
  readonly devicePixelRatio: number;
  readonly sampleCount: number;
  readonly weightedTransparency: boolean;
  readonly estimatedBytes: number;
}

/** Immutable snapshot used by tests and the opt-in benchmark report. */
export interface GpuCostSnapshot {
  readonly passes: Readonly<Record<GpuCostPass, number>>;
  readonly draws: Readonly<Record<GpuCostDraw, GpuDrawCost>>;
  readonly writes: Readonly<Record<GpuCostWrite, GpuWriteCost>>;
  readonly cpu: Readonly<Record<GpuCostCpu, number>>;
  readonly targets: GpuTargetCost | undefined;
}

interface MutableDrawCost {
  calls: number;
  indices: number;
  instances: number;
}

interface MutableWriteCost {
  calls: number;
  bytes: number;
}

/** Mutable owner of one frame's internal rendering cost counters. */
export class GpuCostAccumulator {
  private readonly passCounts = emptyCounts(GPU_COST_PASSES);
  private readonly drawCounts = emptyRecord<GpuCostDraw, MutableDrawCost>(GPU_COST_DRAWS, () => ({
    calls: 0,
    indices: 0,
    instances: 0,
  }));
  private readonly writeCounts = emptyRecord<GpuCostWrite, MutableWriteCost>(
    GPU_COST_WRITES,
    () => ({ calls: 0, bytes: 0 }),
  );
  private readonly cpuCounts = emptyCounts(GPU_COST_CPU);
  private targetCost: GpuTargetCost | undefined;

  /** Clears all counters before encoding a new visible frame. */
  public reset(): void {
    for (const pass of GPU_COST_PASSES) this.passCounts[pass] = 0;
    for (const draw of GPU_COST_DRAWS)
      this.drawCounts[draw] = { calls: 0, indices: 0, instances: 0 };
    for (const write of GPU_COST_WRITES) this.writeCounts[write] = { calls: 0, bytes: 0 };
    for (const work of GPU_COST_CPU) this.cpuCounts[work] = 0;
    this.targetCost = undefined;
  }

  public pass(pass: GpuCostPass): void {
    this.passCounts[pass] += 1;
  }

  public draw(draw: GpuCostDraw, indices: number, instances = 1): void {
    const count = this.drawCounts[draw];
    count.calls += 1;
    count.indices += indices;
    count.instances += instances;
  }

  public write(write: GpuCostWrite, bytes: number): void {
    const count = this.writeCounts[write];
    count.calls += 1;
    count.bytes += bytes;
  }

  public cpu(work: GpuCostCpu, count: number): void {
    this.cpuCounts[work] += count;
  }

  public targets(
    width: number,
    height: number,
    devicePixelRatio: number,
    weightedTransparency = true,
  ): void {
    const pixels = width * height;
    this.targetCost = {
      width,
      height,
      devicePixelRatio,
      sampleCount: 4,
      weightedTransparency,
      // The no-weighted path retains only MSAA color and depth. The weighted
      // path adds the resolved opaque color, rgba16f accumulation, and r8
      // revealage targets (81 bytes per physical pixel in total).
      estimatedBytes: pixels * (weightedTransparency ? 81 : 32),
    };
  }

  /** Returns a detached snapshot safe for benchmark serialization. */
  public snapshot(): GpuCostSnapshot {
    return {
      passes: { ...this.passCounts },
      draws: cloneRecord(this.drawCounts),
      writes: cloneRecord(this.writeCounts),
      cpu: { ...this.cpuCounts },
      targets: this.targetCost === undefined ? undefined : { ...this.targetCost },
    };
  }
}

function emptyCounts<const Keys extends readonly string[]>(
  keys: Keys,
): Record<Keys[number], number> {
  return Object.fromEntries(keys.map((key) => [key, 0])) as Record<Keys[number], number>;
}

function emptyRecord<K extends string, V>(keys: readonly K[], create: () => V): Record<K, V> {
  return Object.fromEntries(keys.map((key) => [key, create()])) as Record<K, V>;
}

function cloneRecord<K extends string, V extends object>(record: Record<K, V>): Record<K, V> {
  return Object.fromEntries(
    (Object.entries(record) as [K, V][]).map(([key, value]) => [key, { ...value }]),
  ) as Record<K, V>;
}
