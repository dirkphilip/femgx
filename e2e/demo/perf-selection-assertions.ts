import { expect } from "@playwright/test";
import type { WebGpuBenchmarkCaseResult } from "../../demo/benchmark/types";

/** Verifies the bounded large-Tet4 select-half, hide-half, and restore report. */
export function expectSelectionHideWorkflow(entry: WebGpuBenchmarkCaseResult): void {
  if (entry.id !== "fe-tet4-solid-132k") return;
  const workflow = entry.selectionHideWorkflow;
  expect(workflow).toBeDefined();
  if (workflow === undefined) throw new Error("Tet4 selection-hide workflow is missing");
  expect(workflow.nodes).toBe(true);
  expect(workflow.authoredEdges).toBe(true);
  expect(workflow.selectedElementCount).toBe(Math.ceil(entry.uniqueElementCount / 2));
  expect(workflow.selectedOccurrenceCount).toBe(1);
  expect(workflow.presentationGpuCost.draws["edges"]?.instances ?? 0).toBeGreaterThan(0);
  expect(workflow.presentationGpuCost.draws["nodes"]?.instances ?? 0).toBeGreaterThan(0);
  expect(workflow.presentationStateMs).toBeGreaterThanOrEqual(0);
  expect(workflow.presentationSyncMs).toBeGreaterThanOrEqual(0);
  expectWorkflowPhase(workflow.selection);
  expectWorkflowPhase(workflow.hide);
  expect(workflow.selection.highlightRetainedBytes).toBeGreaterThan(0);
  expect(workflow.selection.topologyRetainedBytes).toBeGreaterThan(0);
  expect(workflow.hide.highlightRetainedBytes).toBeGreaterThan(
    workflow.selection.highlightRetainedBytes,
  );
  expect(workflow.hide.highlightRetainedBytes).toBeLessThan(64 * 1024);
  expect(workflow.hide.topologyRetainedBytes).toBe(workflow.selection.topologyRetainedBytes);
  expect(workflow.restoreStateMs).toBeGreaterThanOrEqual(0);
  expect(workflow.restoreSyncMs).toBeGreaterThanOrEqual(0);
  expect(workflow.restoredVisibleElementCount).toBe(entry.uniqueElementCount);
}

function expectWorkflowPhase(
  phase: NonNullable<WebGpuBenchmarkCaseResult["selectionHideWorkflow"]>["selection"],
): void {
  expect(phase.interactionStateMs).toBeGreaterThanOrEqual(0);
  expect(phase.interactionSyncMs).toBeGreaterThanOrEqual(0);
  expect(phase.highlightRetainedBytes).toBeGreaterThan(0);
  expect(phase.topologyRetainedBytes).toBeGreaterThan(0);
  expect(phase.frames.firstFrameMs).toBeGreaterThanOrEqual(0);
  expect(phase.frames.steadyFrameMs.p95).toBeGreaterThanOrEqual(phase.frames.steadyFrameMs.p50);
  expect(phase.frames.movingFirstFrameMs).toBeGreaterThanOrEqual(0);
  expect(phase.frames.movingSteadyFrameMs.p95).toBeGreaterThanOrEqual(
    phase.frames.movingSteadyFrameMs.p50,
  );
}

/** Returns the complete selection phase count for a benchmark case. */
export function expectedSelectionPhaseCount(caseId: string): number {
  if (caseId === "fe-tet4-solid-132k") return 5;
  if (caseId === "instanced-2.10m" || caseId === "unique-2m-local") return 6;
  return caseId === "unique-1m" ? 4 : 3;
}

/** Verifies that complete unique-surface selection stays in the ordinary pass. */
export function expectCompleteUniqueSelection(entry: WebGpuBenchmarkCaseResult): void {
  if (entry.id !== "unique-1m") return;
  const all = entry.selection?.phases.find((phase) => phase.id === "all-authored");
  expect(all?.returnedTargetCount).toBe(entry.uniqueElementCount);
  expect(all?.selectedOccurrenceCount).toBe(1);
  expect(all?.interactionGpuCost.draws["selection-visible"]?.calls ?? 0).toBe(0);
  expect(all?.interactionGpuCost.draws["selection-hidden"]?.calls ?? 0).toBe(0);
}

/** Returns the distance between two benchmark camera positions. */
export function cameraPositionDistance(
  first: { readonly position: readonly number[] },
  second: { readonly position: readonly number[] },
): number {
  return Math.hypot(
    (first.position[0] ?? 0) - (second.position[0] ?? 0),
    (first.position[1] ?? 0) - (second.position[1] ?? 0),
    (first.position[2] ?? 0) - (second.position[2] ?? 0),
  );
}
