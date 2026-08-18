import { expect } from "@playwright/test";
import type { WebGpuBenchmarkCaseResult } from "../../demo/benchmark/types";

/** Guards the extra interaction seams on both two-million-triangle workloads. */
export function expectTwoMillionInteractions(entry: WebGpuBenchmarkCaseResult): void {
  if (entry.id !== "instanced-2.10m" && entry.id !== "unique-2m-local") return;
  expect(entry.hover).toMatchObject({ targetKind: "element", selectedOccurrenceCount: 1 });
  expect(entry.hover?.pickMs).toBeGreaterThan(0);
  expect(entry.hover?.interactionHighlightWriteBytes).toBeGreaterThan(0);
  expect(entry.hover?.steadyHoveredFrameMs.p95).toBeGreaterThanOrEqual(
    entry.hover?.steadyHoveredFrameMs.p50 ?? 0,
  );
  for (const phase of entry.selection?.phases.filter(({ id }) => id.endsWith("-authored")) ?? []) {
    const ranged = phase.returnedTargetCount * (entry.elementFamily === "quad" ? 6 : 3);
    const full = entry.uniqueTriangles * 3;
    const indices = ranged * 2 < full ? ranged : full;
    for (const pass of ["selection-visible", "selection-hidden"] as const) {
      expect(phase.interactionGpuCost.draws[pass]).toEqual({ calls: 1, indices, instances: 1 });
    }
  }
  expect(entry.visibility?.phases).toHaveLength(entry.instanceCount === 1 ? 1 : 3);
  for (const phase of entry.visibility?.phases ?? []) {
    expect(phase.hiddenOccurrenceCount).toBeGreaterThan(0);
    expect(phase.remainingVisibleTriangles).toBe(
      entry.submittedTriangles -
        (entry.submittedTriangles / entry.instanceCount) * phase.hiddenOccurrenceCount,
    );
    expect(phase.visibleSurfaceSubmittedIndices).toBe(phase.remainingVisibleTriangles * 3);
    expect(phase.restoredSurfaceSubmittedIndices).toBe(entry.submittedTriangles * 3);
    expect(phase.steadyHiddenFrameMs.p95).toBeGreaterThanOrEqual(phase.steadyHiddenFrameMs.p50);
  }
  expectCombinedOverlay(entry);
}

function expectCombinedOverlay(entry: WebGpuBenchmarkCaseResult): void {
  const overlay = entry.combinedOverlay;
  if (overlay === undefined) throw new Error(`${entry.id} combined overlay report is missing`);
  expect(overlay).toMatchObject({
    nodes: true,
    presentationEdges: true,
    materializedEdgePartCount: entry.partCount,
  });
  expect(overlay.estimatedRetainedEdgeBufferUpperBoundBytes).toBeGreaterThan(0);
  if (entry.id === "unique-2m-local") {
    expect(overlay.edgeConstructionTypedArrayBytes).toBe(252_663_296);
    expect(overlay.edgeFinalTypedArrayBytes).toBe(264_112_000);
    expect(overlay.edgeGuaranteedTypedArrayOverlapBytes).toBe(416_112_000);
    expect(overlay.edgeNoIntermediateGcTypedArrayUpperBoundBytes).toBe(516_775_296);
  } else {
    expect(overlay.edgeConstructionTypedArrayBytes).toBeUndefined();
    expect(overlay.edgeFinalTypedArrayBytes).toBeUndefined();
    expect(overlay.edgeGuaranteedTypedArrayOverlapBytes).toBeUndefined();
    expect(overlay.edgeNoIntermediateGcTypedArrayUpperBoundBytes).toBeUndefined();
  }
  expect(overlay.coldNodeGpuCost.draws["nodes"]).toMatchObject({
    calls: entry.partCount,
    instances: entry.instanceCount,
  });
  expect(overlay.coldEdgeGpuCost.draws["edges"]).toMatchObject({
    calls: entry.partCount,
    instances: entry.instanceCount,
  });
  expect(overlay.largeSelection.targetCount).toBe(entry.uniqueElementCount);
  expect(overlay.largeSelection.interactionHighlightWriteBytes).toBeGreaterThan(0);
  expect(overlay.largeSelection.gpuCost.draws["nodes"]?.instances).toBe(entry.instanceCount);
  expect(overlay.largeSelection.gpuCost.draws["edges"]?.instances).toBe(entry.instanceCount);
  const selectedIndices = entry.uniqueElementCount * (entry.elementFamily === "quad" ? 6 : 3);
  for (const pass of ["selection-visible", "selection-hidden"] as const) {
    expect(overlay.largeSelection.gpuCost.draws[pass]).toEqual({
      calls: 1,
      indices: selectedIndices,
      instances: 1,
    });
  }
}
