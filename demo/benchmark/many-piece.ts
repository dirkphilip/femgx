import {
  createInteractionState,
  setPartOccurrenceOverrides,
} from "../../src/interaction/interaction";
import { setTargetsSelected } from "../../src/interaction/targets";
import type { InteractionTarget } from "../../src/interaction/target-types";
import type { InteractionState } from "../../src/interaction/state";
import { readGpuCostSnapshot, type WebGpuRenderer } from "../../src/renderer/gpu-renderer";
import { INSTANCE_STRIDE } from "../../src/renderer/resources/instance-storage";
import type { PackedSceneRuntime } from "../../src/scene-runtime/runtime";
import type { PartOccurrenceId } from "../../src/scene/types";
import { changedInstanceSlots } from "../../src/viewport/interaction-diff";
import type { Camera } from "../../src/camera/camera";
import type { WebGpuBenchmarkCase } from "./model";
import type {
  BenchmarkGpuCostSnapshot,
  BenchmarkPercentiles,
  ManyPieceBenchmarkReport,
  ManyPieceInteractionPhase,
} from "./types";
import { assertNoElementEmphasisDraw } from "./assertions";
import { measureManyPieceReplacement } from "./many-piece-replacement";

const SUPPORTED_CASES = new Set(["many-parts-1000", "placements-10k"]);
const STEADY_SAMPLES = 7;
const RECOLOR = { color: { r: 0.2, g: 0.7, b: 0.4, a: 1 } } as const;

interface ManyPieceMeasureOptions {
  readonly renderer: WebGpuRenderer;
  readonly device: GPUDevice;
  readonly benchmarkCase: WebGpuBenchmarkCase;
  readonly runtime: PackedSceneRuntime;
  readonly camera: Camera;
}

/** Measures occurrence selection and recolor across one, half, and all pieces. */
export async function measureManyPieceBenchmark(
  options: ManyPieceMeasureOptions,
): Promise<ManyPieceBenchmarkReport | undefined> {
  if (!SUPPORTED_CASES.has(options.benchmarkCase.id)) return undefined;
  const selection: ManyPieceInteractionPhase[] = [];
  const recolor: ManyPieceInteractionPhase[] = [];
  for (const id of ["one", "half", "all"] as const) {
    const count = targetCount(options.runtime.instanceCount, id);
    selection.push(await measureSelection(options, id, count));
    recolor.push(await measureRecolor(options, id, count));
  }
  const replacement = await measureManyPieceReplacement(options);
  return { selection, recolor, replacement };
}

async function measureSelection(
  options: ManyPieceMeasureOptions,
  id: ManyPieceInteractionPhase["id"],
  count: number,
): Promise<ManyPieceInteractionPhase> {
  const targetStart = performance.now();
  const targets = instanceTargets(options.runtime, count);
  const targetConstructionMs = performance.now() - targetStart;
  const stateStart = performance.now();
  const interaction = setTargetsSelected(createInteractionState(), targets, true);
  const interactionStateMs = performance.now() - stateStart;
  return measureInteraction(options, id, targets.length, interaction, {
    targetConstructionMs,
    interactionStateMs,
    assertFrame: (cost) => {
      assertSelectedPieces(options, count, cost);
    },
  });
}

async function measureRecolor(
  options: ManyPieceMeasureOptions,
  id: ManyPieceInteractionPhase["id"],
  count: number,
): Promise<ManyPieceInteractionPhase> {
  const targetStart = performance.now();
  const overrides = selectedPartOccurrenceIds(options.runtime, count).map(
    (partOccurrenceId) => [partOccurrenceId, RECOLOR] as const,
  );
  const targetConstructionMs = performance.now() - targetStart;
  const stateStart = performance.now();
  const interaction = setPartOccurrenceOverrides(createInteractionState(), overrides);
  const interactionStateMs = performance.now() - stateStart;
  return measureInteraction(options, id, overrides.length, interaction, {
    targetConstructionMs,
    interactionStateMs,
    assertFrame: (cost) => {
      assertNoElementEmphasisDraw(cost, `${options.benchmarkCase.id} ${id} recolor`);
      assertOpaqueDraw(options, cost);
    },
  });
}

async function measureInteraction(
  options: ManyPieceMeasureOptions,
  id: ManyPieceInteractionPhase["id"],
  targetCountValue: number,
  interaction: InteractionState,
  setup: {
    readonly targetConstructionMs: number;
    readonly interactionStateMs: number;
    readonly assertFrame: (cost: BenchmarkGpuCostSnapshot) => void;
  },
): Promise<ManyPieceInteractionPhase> {
  const empty = createInteractionState();
  const slotStart = performance.now();
  const changedSlots = changedInstanceSlots(options.runtime, empty, interaction);
  const changedSlotResolutionMs = performance.now() - slotStart;
  if (changedSlots.length !== targetCountValue) {
    throw new Error(`${options.benchmarkCase.id} ${id} resolved ${changedSlots.length} slots`);
  }
  await renderFrame(options);
  const before = readGpuCostSnapshot(options.renderer);
  const syncStart = performance.now();
  syncInteraction(options, interaction, changedSlots);
  const interactionSyncMs = performance.now() - syncStart;
  const after = readGpuCostSnapshot(options.renderer);
  const instanceWriteBytes = writeBytesSince(before, after, options, id, targetCountValue);
  const firstFrameMs = await renderFrame(options);
  const gpuCost = readGpuCostSnapshot(options.renderer);
  setup.assertFrame(gpuCost);
  const steady: number[] = [];
  for (let sample = 0; sample < STEADY_SAMPLES; sample += 1) {
    steady.push(await renderFrame(options));
  }
  const clearStart = performance.now();
  const beforeClear = readGpuCostSnapshot(options.renderer);
  syncInteraction(options, empty, changedSlots);
  const afterClear = readGpuCostSnapshot(options.renderer);
  const clearInstanceWriteBytes = writeBytesSince(
    beforeClear,
    afterClear,
    options,
    id,
    targetCountValue,
  );
  await renderFrame(options);
  assertNoElementEmphasisDraw(
    readGpuCostSnapshot(options.renderer),
    `${options.benchmarkCase.id} clear`,
  );
  const clearMs = performance.now() - clearStart;
  return {
    id,
    targetCount: targetCountValue,
    targetConstructionMs: setup.targetConstructionMs,
    interactionStateMs: setup.interactionStateMs,
    changedSlotResolutionMs,
    interactionSyncMs,
    instanceWriteBytes,
    firstFrameMs,
    steadyFrameMs: percentiles(steady),
    clearMs,
    clearInstanceWriteBytes,
    gpuCost,
  };
}

function syncInteraction(
  options: ManyPieceMeasureOptions,
  interaction: InteractionState,
  changedSlots: readonly number[],
): void {
  options.renderer.updateInstances(options.runtime, interaction, changedSlots);
  options.renderer.updateElements(options.runtime, interaction, changedSlots);
}

function instanceTargets(runtime: PackedSceneRuntime, count: number): InteractionTarget[] {
  return selectedPartOccurrenceIds(runtime, count).map((partOccurrenceId) => ({
    kind: "partOccurrence",
    partOccurrenceId,
  }));
}

function selectedPartOccurrenceIds(runtime: PackedSceneRuntime, count: number): PartOccurrenceId[] {
  const ids = new Array<PartOccurrenceId>(count);
  for (let slot = 0; slot < count; slot += 1) {
    const partOccurrenceId = runtime.getInstanceId(slot);
    if (partOccurrenceId === undefined) throw new Error(`Benchmark occurrence ${slot} is missing`);
    ids[slot] = partOccurrenceId;
  }
  return ids;
}

function targetCount(count: number, id: ManyPieceInteractionPhase["id"]): number {
  return id === "one" ? 1 : id === "half" ? Math.ceil(count / 2) : count;
}

function writeBytesSince(
  before: BenchmarkGpuCostSnapshot,
  after: BenchmarkGpuCostSnapshot,
  options: ManyPieceMeasureOptions,
  id: ManyPieceInteractionPhase["id"],
  targetCountValue: number,
): number {
  const beforeWrite = before.writes["instance"];
  const afterWrite = after.writes["instance"];
  const calls = (afterWrite?.calls ?? 0) - (beforeWrite?.calls ?? 0);
  const bytes = (afterWrite?.bytes ?? 0) - (beforeWrite?.bytes ?? 0);
  const expectedBytes = targetCountValue * INSTANCE_STRIDE;
  if (calls <= 0 || bytes !== expectedBytes) {
    throw new Error(
      `${options.benchmarkCase.id} ${id} wrote ${bytes} instance bytes; expected ${expectedBytes}`,
    );
  }
  return bytes;
}

function assertSelectedPieces(
  options: ManyPieceMeasureOptions,
  count: number,
  cost: BenchmarkGpuCostSnapshot,
): void {
  const expected = selectedDraw(options, count);
  for (const pass of ["selection-visible", "selection-hidden"] as const) {
    const actual = cost.draws[pass];
    if (
      actual?.calls !== expected.calls ||
      actual.indices !== expected.indices ||
      actual.instances !== expected.instances
    ) {
      throw new Error(`${options.benchmarkCase.id} omitted ${pass}: ${JSON.stringify(actual)}`);
    }
  }
}

function selectedDraw(
  options: ManyPieceMeasureOptions,
  count: number,
): { readonly calls: number; readonly indices: number; readonly instances: number } {
  const parts = new Map<number, number>();
  for (let slot = 0; slot < count; slot += 1) {
    const partId = options.runtime.getPartId(slot);
    if (partId !== undefined) parts.set(partId, (parts.get(partId) ?? 0) + 1);
  }
  let indices = 0;
  let instances = 0;
  for (const [partId, selected] of parts) {
    const part = options.benchmarkCase.scene.parts.get(partId);
    indices += part?.geometries.reduce((sum, geometry) => sum + geometry.indices.length, 0) ?? 0;
    instances += selected;
  }
  return { calls: parts.size, indices, instances };
}

function assertOpaqueDraw(options: ManyPieceMeasureOptions, cost: BenchmarkGpuCostSnapshot): void {
  const expected = selectedDraw(options, options.runtime.instanceCount);
  const actual = cost.draws["opaque"];
  if (
    actual?.calls !== expected.calls ||
    actual.indices !== expected.indices ||
    actual.instances !== expected.instances
  ) {
    throw new Error(`${options.benchmarkCase.id} recolor omitted opaque work`);
  }
}

async function renderFrame(options: ManyPieceMeasureOptions): Promise<number> {
  const start = performance.now();
  options.renderer.render(options.runtime, options.camera, options.benchmarkCase.scene.parts);
  await options.device.queue.onSubmittedWorkDone();
  return performance.now() - start;
}

function percentiles(values: readonly number[]): BenchmarkPercentiles {
  const sorted = [...values].sort((left, right) => left - right);
  const at = (fraction: number): number => sorted[Math.ceil(sorted.length * fraction) - 1] ?? 0;
  return { p50: at(0.5), p95: at(0.95) };
}
