import { expect } from "@playwright/test";
import type { WebGpuBenchmarkCaseResult } from "../../demo/benchmark/runner";

const NODE_COUNT = 24_389;
const HALF_NODE_COUNT = Math.floor(NODE_COUNT / 2);
const NODE_DRAW_VERTICES = 4;
const DENSE_NODE_BYTES = 3_056;
const HIGHLIGHT_STORAGE_BYTES = 3_200;

/** Asserts the real-WebGPU dense node-selection workload and storage boundaries. */
export function expectDenseNodeSelectionReport(entry: WebGpuBenchmarkCaseResult): void {
  const report = entry.nodeSelection;
  expect(report?.selectedTargetGranularity).toBe("node");
  expect(report?.phases.map((phase) => phase.id)).toEqual(["half", "all"]);
  if (report === undefined) throw new Error("Tet4 node-selection report is missing");
  expect(report.nodeCenterBytes).toBe(NODE_COUNT * 3 * Float32Array.BYTES_PER_ELEMENT);
  expect(report.nodeIdBytes).toBe(NODE_COUNT * Uint32Array.BYTES_PER_ELEMENT);
  expect(report.nodeSpriteIndexBytes).toBe(0);
  for (const phase of report.phases) {
    const expectedNodes = phase.id === "half" ? HALF_NODE_COUNT : NODE_COUNT;
    expect(phase.targetCount).toBe(expectedNodes);
    expect(phase.uniqueNodeCount).toBe(expectedNodes);
    expect(phase.selectedOccurrenceCount).toBe(1);
    expect(phase.selectedNodeDrawVertices).toBe(NODE_DRAW_VERTICES);
    expect(phase.selectedNodeDrawInstances).toBe(NODE_COUNT);
    expect(phase.interactionStateMs).toBeGreaterThanOrEqual(0);
    expect(phase.interactionSyncMs).toBeGreaterThanOrEqual(0);
    expect(phase.firstSelectedFrameMs).toBeGreaterThanOrEqual(0);
    expect(phase.steadySelectedFrameMs.p50).toBeGreaterThanOrEqual(0);
    expect(phase.steadySelectedFrameMs.p95).toBeGreaterThanOrEqual(phase.steadySelectedFrameMs.p50);
    expect(phase.clearSelectionMs).toBeGreaterThanOrEqual(0);
    expect(phase.denseNodePayloadBytes).toBe(DENSE_NODE_BYTES);
    expect(phase.highlightStorageBytes).toBe(HIGHLIGHT_STORAGE_BYTES);
    expect(phase.selectedNodeRecordBytes).toBe(expectedNodes * 48);
    expect(phase.denseNodePayloadBytes).toBeLessThan(phase.selectedNodeRecordBytes);
    for (const pass of ["selection-visible", "selection-hidden"] as const) {
      const aggregate = phase.interactionGpuCost.draws[pass];
      expect(aggregate?.calls).toBeGreaterThanOrEqual(1);
      expect(aggregate?.indices).toBe(phase.selectedNodeDrawVertices);
      expect(aggregate?.instances).toBe(phase.selectedNodeDrawInstances);
    }
  }
}
