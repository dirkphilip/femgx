import { expect } from "@playwright/test";
import type { WebGpuBenchmarkCaseResult } from "../../demo/benchmark/runner";

const NODE_DRAW_VERTICES = 4;

/** Asserts the real-WebGPU dense node-selection workload and storage boundaries. */
export function expectDenseNodeSelectionReport(entry: WebGpuBenchmarkCaseResult): void {
  expectNodeSelectionReport(entry, 24_389);
}

/** Asserts one complete real-WebGPU selected-node scaling matrix. */
export function expectNodeSelectionReport(
  entry: WebGpuBenchmarkCaseResult,
  nodeCount: number,
): void {
  const report = entry.nodeSelection;
  const expectedCounts = expectedSelectionCounts(nodeCount);
  expect(report?.selectedTargetGranularity).toBe("node");
  expect(report?.phases.map((phase) => phase.id)).toEqual(Object.keys(expectedCounts));
  if (report === undefined) throw new Error("Tet4 node-selection report is missing");
  expect(report.nodeCenterBytes).toBe(nodeCount * 3 * Float32Array.BYTES_PER_ELEMENT);
  expect(report.nodeIdBytes).toBe(nodeCount * Uint32Array.BYTES_PER_ELEMENT);
  expect(report.nodeSpriteIndexBytes).toBe(0);
  for (const phase of report.phases) {
    const expectedNodes = expectedCounts[phase.id];
    expect(phase.targetCount).toBe(expectedNodes);
    expect(phase.uniqueNodeCount).toBe(expectedNodes);
    expect(phase.selectedOccurrenceCount).toBe(1);
    expect(phase.selectedNodeDrawVertices).toBe(NODE_DRAW_VERTICES);
    const dense = phase.id === "dense-boundary" || phase.id === "all";
    const expectedInstances = dense ? nodeCount : expectedNodes;
    const expectedOrderBytes = dense ? 4 : expectedNodes * 8;
    expect(phase.selectedNodeDrawInstances).toBe(expectedInstances);
    expect(phase.selectedNodeCalls).toBe(1);
    expect(phase.selectedNodeOrderBytes).toBe(expectedOrderBytes);
    expect(phase.selectedNodeOrderUploadBytes).toBe(expectedOrderBytes);
    expect(phase.selectedNodeOrderUploadCalls).toBe(1);
    expect(phase.interactionStateMs).toBeGreaterThanOrEqual(0);
    expect(phase.interactionSyncMs).toBeGreaterThanOrEqual(0);
    expect(phase.firstSelectedFrameMs).toBeGreaterThanOrEqual(0);
    expect(phase.firstSelectedFrameCpuMs).toBeGreaterThanOrEqual(0);
    expect(phase.firstSelectedFrameMs).toBeGreaterThanOrEqual(phase.firstSelectedFrameCpuMs);
    expect(phase.steadySelectedFrameMs.p50).toBeGreaterThanOrEqual(0);
    expect(phase.steadySelectedFrameMs.p95).toBeGreaterThanOrEqual(phase.steadySelectedFrameMs.p50);
    expect(phase.movingSelectedFrameMs.p50).toBeGreaterThanOrEqual(0);
    expect(phase.movingSelectedFrameMs.p95).toBeGreaterThanOrEqual(phase.movingSelectedFrameMs.p50);
    expect(phase.clearSelectionMs).toBeGreaterThanOrEqual(0);
    expect(phase.denseNodePayloadBytes).toBeGreaterThanOrEqual(0);
    expect(phase.highlightStorageBytes).toBeGreaterThanOrEqual(96);
    expect(phase.selectedNodeRecordBytes).toBe(expectedNodes * 48);
    expect(phase.denseNodePayloadBytes).toBeLessThanOrEqual(phase.selectedNodeRecordBytes);
    expect(phase.interactionGpuCost.draws["nodes"]?.calls ?? 0).toBe(0);
    for (const pass of ["selection-visible", "selection-hidden"] as const) {
      const aggregate = phase.interactionGpuCost.draws[pass];
      expect(aggregate?.calls).toBeGreaterThanOrEqual(1);
      expect(aggregate?.indices).toBe(phase.selectedNodeDrawVertices);
      expect(aggregate?.instances).toBe(phase.selectedNodeDrawInstances);
    }
  }
}

function expectedSelectionCounts(nodeCount: number) {
  const sparseCount = Math.floor(nodeCount / 16);
  const denseBoundary = Math.ceil((nodeCount * 7) / 8);
  return {
    one: 1,
    contiguous: sparseCount,
    fragmented: sparseCount,
    half: Math.floor(nodeCount / 2),
    "near-all": denseBoundary - 1,
    "dense-boundary": denseBoundary,
    all: nodeCount,
  } as const;
}
