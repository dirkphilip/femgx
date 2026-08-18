import { expect } from "@playwright/test";
import type { WebGpuBenchmarkCaseResult } from "../../demo/benchmark/types";

const CASE_IDS = new Set(["many-parts-1000", "placements-10k"]);

/** Asserts exact occurrence counts and renderer work for the many-piece matrix. */
export function expectManyPieceReport(entry: WebGpuBenchmarkCaseResult): void {
  if (!CASE_IDS.has(entry.id)) return;
  const report = entry.manyPiece;
  if (report === undefined) throw new Error(`${entry.id} many-piece report is missing`);
  const counts = [1, Math.ceil(entry.instanceCount / 2), entry.instanceCount];
  for (const phases of [report.selection, report.recolor]) {
    expect(phases.map((phase) => phase.id)).toEqual(["one", "half", "all"]);
    expect(phases.map((phase) => phase.targetCount)).toEqual(counts);
    for (const phase of phases) {
      expect(phase.targetConstructionMs).toBeGreaterThanOrEqual(0);
      expect(phase.interactionStateMs).toBeGreaterThanOrEqual(0);
      expect(phase.changedSlotResolutionMs).toBeGreaterThanOrEqual(0);
      expect(phase.interactionSyncMs).toBeGreaterThanOrEqual(0);
      expect(phase.instanceWriteBytes).toBe(phase.targetCount * 96);
      expect(phase.firstFrameMs).toBeGreaterThanOrEqual(0);
      expect(phase.steadyFrameMs.p95).toBeGreaterThanOrEqual(phase.steadyFrameMs.p50);
      expect(phase.clearMs).toBeGreaterThanOrEqual(0);
      expect(phase.clearInstanceWriteBytes).toBe(phase.targetCount * 96);
    }
  }
  for (const phase of report.selection) {
    const expected = selectionDraw(entry, phase.targetCount);
    expect(phase.gpuCost.draws["selection-visible"]).toEqual(expected);
    expect(phase.gpuCost.draws["selection-hidden"]).toEqual(expected);
  }
  for (const phase of report.recolor) {
    expect(phase.gpuCost.draws["opaque"]).toEqual(surfaceDraw(entry));
  }
  expect(report.replacement.map((phase) => phase.id)).toEqual(["one", "half", "all"]);
  expect(report.replacement.map((phase) => phase.changedOccurrenceCount)).toEqual(counts);
  for (const phase of report.replacement) {
    expect(phase.sceneBuildIncludingValidationMs).toBeGreaterThanOrEqual(0);
    expect(phase.runtimeCompileMs).toBeGreaterThanOrEqual(0);
    expect(phase.rendererFirstFrameCpuMs).toBeGreaterThanOrEqual(0);
    expect(phase.queueDrainedFirstFrameMs).toBeGreaterThanOrEqual(phase.rendererFirstFrameCpuMs);
    expect(phase.instanceWriteBytes).toBe(phase.changedOccurrenceCount * 96);
    expect(phase.gpuCost.writes["instance"]?.calls ?? 0).toBeGreaterThan(0);
    expect(phase.steadyFrameMs.p95).toBeGreaterThanOrEqual(phase.steadyFrameMs.p50);
    expect(phase.restoreMs).toBeGreaterThanOrEqual(0);
    expect(phase.restoreInstanceWriteBytes).toBe(phase.changedOccurrenceCount * 96);
    expect(phase.gpuCost.draws["opaque"]).toEqual(surfaceDraw(entry));
  }
  expectVisibility(entry);
}

function selectionDraw(
  entry: WebGpuBenchmarkCaseResult,
  count: number,
): { readonly calls: number; readonly indices: number; readonly instances: number } {
  return entry.id === "placements-10k"
    ? { calls: 1, indices: 384, instances: count }
    : { calls: count, indices: 2_904 * count, instances: count };
}

function surfaceDraw(entry: WebGpuBenchmarkCaseResult): {
  readonly calls: number;
  readonly indices: number;
  readonly instances: number;
} {
  return entry.id === "placements-10k"
    ? { calls: 1, indices: 384, instances: 10_000 }
    : { calls: 1_000, indices: 2_904_000, instances: 1_000 };
}

function expectVisibility(entry: WebGpuBenchmarkCaseResult): void {
  const phases = entry.visibility?.phases;
  if (phases === undefined) throw new Error(`${entry.id} visibility report is missing`);
  expect(phases.map((phase) => phase.id)).toEqual(["one", "half", "all"]);
  expect(phases.map((phase) => phase.hiddenOccurrenceCount)).toEqual([
    1,
    Math.ceil(entry.instanceCount / 2),
    entry.instanceCount,
  ]);
  for (const phase of phases) {
    expect(phase.visibleSurfaceSubmittedIndices).toBe(phase.remainingVisibleTriangles * 3);
    expect(phase.restoredSurfaceSubmittedIndices).toBe(entry.submittedTriangles * 3);
    expect(phase.rendererSyncMs).toBeGreaterThanOrEqual(0);
    expect(phase.steadyHiddenFrameMs.p95).toBeGreaterThanOrEqual(phase.steadyHiddenFrameMs.p50);
  }
}
