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

/** Internal draw-path admissions reported by the opt-in cost snapshot. */
export const GPU_COST_ADMISSIONS = ["minimal", "topology", "feature"] as const;
export type GpuCostAdmission = (typeof GPU_COST_ADMISSIONS)[number];

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

/** Resource lifecycle deltas observed while encoding the current frame. */
export interface GpuMemoryCost {
  readonly allocatedBytes: number;
  readonly releasedBytes: number;
  readonly bufferCreates: number;
  readonly bufferDestroys: number;
  readonly bindGroupInvalidations: number;
}

/** Immutable snapshot used by tests and the opt-in benchmark report. */
export interface GpuCostSnapshot {
  readonly passes: Readonly<Record<GpuCostPass, number>>;
  readonly draws: Readonly<Record<GpuCostDraw, GpuDrawCost>>;
  readonly admissions: Readonly<Record<GpuCostAdmission, number>>;
  readonly writes: Readonly<Record<GpuCostWrite, GpuWriteCost>>;
  readonly cpu: Readonly<Record<GpuCostCpu, number>>;
  readonly memory: GpuMemoryCost;
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

interface MutableMemoryCost {
  allocatedBytes: number;
  releasedBytes: number;
  bufferCreates: number;
  bufferDestroys: number;
  bindGroupInvalidations: number;
}

/** Mutable owner of one frame's internal rendering cost counters. */
export class GpuCostAccumulator {
  private readonly passCounts = emptyPassCounts();
  private readonly drawCounts = emptyDrawCounts();
  private readonly admissionCounts = emptyAdmissionCounts();
  private readonly writeCounts = emptyWriteCounts();
  private readonly cpuCounts = emptyCpuCounts();
  private readonly memoryCounts = emptyMemoryCounts();
  private targetCost: GpuTargetCost | undefined;

  /** Clears all counters before encoding a new visible frame. */
  public reset(): void {
    for (const pass of GPU_COST_PASSES) this.passCounts[pass] = 0;
    for (const draw of GPU_COST_DRAWS)
      this.drawCounts[draw] = { calls: 0, indices: 0, instances: 0 };
    for (const admission of GPU_COST_ADMISSIONS) this.admissionCounts[admission] = 0;
    for (const write of GPU_COST_WRITES) this.writeCounts[write] = { calls: 0, bytes: 0 };
    for (const work of GPU_COST_CPU) this.cpuCounts[work] = 0;
    this.memoryCounts.allocatedBytes = 0;
    this.memoryCounts.releasedBytes = 0;
    this.memoryCounts.bufferCreates = 0;
    this.memoryCounts.bufferDestroys = 0;
    this.memoryCounts.bindGroupInvalidations = 0;
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

  /** Records one successfully encoded batch under its admitted draw path. */
  public admission(admission: GpuCostAdmission): void {
    this.admissionCounts[admission] += 1;
  }

  public write(write: GpuCostWrite, bytes: number): void {
    const count = this.writeCounts[write];
    count.calls += 1;
    count.bytes += bytes;
  }

  public cpu(work: GpuCostCpu, count: number): void {
    this.cpuCounts[work] += count;
  }

  public allocateBuffer(bytes: number): void {
    this.memoryCounts.allocatedBytes += bytes;
    this.memoryCounts.bufferCreates += 1;
  }

  public releaseBuffer(bytes: number): void {
    this.memoryCounts.releasedBytes += bytes;
    this.memoryCounts.bufferDestroys += 1;
  }

  public invalidateBindGroups(count = 1): void {
    this.memoryCounts.bindGroupInvalidations += count;
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
      draws: cloneDrawCounts(this.drawCounts),
      admissions: { ...this.admissionCounts },
      writes: cloneWriteCounts(this.writeCounts),
      cpu: { ...this.cpuCounts },
      memory: { ...this.memoryCounts },
      targets: this.targetCost === undefined ? undefined : { ...this.targetCost },
    };
  }
}

function emptyMemoryCounts(): MutableMemoryCost {
  return {
    allocatedBytes: 0,
    releasedBytes: 0,
    bufferCreates: 0,
    bufferDestroys: 0,
    bindGroupInvalidations: 0,
  };
}

function emptyPassCounts(): Record<GpuCostPass, number> {
  return {
    opaque: 0,
    transparency: 0,
    composite: 0,
    pick: 0,
  };
}

function emptyCpuCounts(): Record<GpuCostCpu, number> {
  return { "instance-scan": 0, "order-rebuild": 0, "call-rebuild": 0 };
}

function emptyAdmissionCounts(): Record<GpuCostAdmission, number> {
  return { minimal: 0, topology: 0, feature: 0 };
}

function drawCost(): MutableDrawCost {
  return { calls: 0, indices: 0, instances: 0 };
}

function emptyDrawCounts(): Record<GpuCostDraw, MutableDrawCost> {
  return {
    background: drawCost(),
    opaque: drawCost(),
    "point-replay": drawCost(),
    "selection-visible": drawCost(),
    "selection-hidden": drawCost(),
    transparency: drawCost(),
    composite: drawCost(),
    edges: drawCost(),
    nodes: drawCost(),
    "vector-glyph": drawCost(),
    "origin-triad": drawCost(),
    pivot: drawCost(),
    pick: drawCost(),
  };
}

function writeCost(): MutableWriteCost {
  return { calls: 0, bytes: 0 };
}

function emptyWriteCounts(): Record<GpuCostWrite, MutableWriteCost> {
  return {
    instance: writeCost(),
    highlight: writeCost(),
    order: writeCost(),
    deformation: writeCost(),
    result: writeCost(),
    "vector-glyph": writeCost(),
    uniform: writeCost(),
    geometry: writeCost(),
    other: writeCost(),
  };
}

function cloneDrawCounts(
  counts: Readonly<Record<GpuCostDraw, MutableDrawCost>>,
): Record<GpuCostDraw, GpuDrawCost> {
  return {
    background: { ...counts.background },
    opaque: { ...counts.opaque },
    "point-replay": { ...counts["point-replay"] },
    "selection-visible": { ...counts["selection-visible"] },
    "selection-hidden": { ...counts["selection-hidden"] },
    transparency: { ...counts.transparency },
    composite: { ...counts.composite },
    edges: { ...counts.edges },
    nodes: { ...counts.nodes },
    "vector-glyph": { ...counts["vector-glyph"] },
    "origin-triad": { ...counts["origin-triad"] },
    pivot: { ...counts.pivot },
    pick: { ...counts.pick },
  };
}

function cloneWriteCounts(
  counts: Readonly<Record<GpuCostWrite, MutableWriteCost>>,
): Record<GpuCostWrite, GpuWriteCost> {
  return {
    instance: { ...counts.instance },
    highlight: { ...counts.highlight },
    order: { ...counts.order },
    deformation: { ...counts.deformation },
    result: { ...counts.result },
    "vector-glyph": { ...counts["vector-glyph"] },
    uniform: { ...counts.uniform },
    geometry: { ...counts.geometry },
    other: { ...counts.other },
  };
}
