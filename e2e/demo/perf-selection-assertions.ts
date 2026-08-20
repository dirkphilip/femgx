import { expect } from "@playwright/test";
import type { WebGpuBenchmarkCaseResult } from "../../demo/benchmark/types";

const HALF_STATE_BUDGET_MS = 100;
const UNSECTIONED_SYNC_BUDGET_MS = 250;
const ACTIVE_SECTION_SYNC_BUDGET_MS = 1_000;
const STEADY_FRAME_BUDGET_MS = 33.3;
const ACTIVE_SECTION_FIRST_FRAME_BUDGET_MS = 500;
const TET4_SELECTION_HIGHLIGHT_BYTES = 16_616;
const TET4_HIDE_HIGHLIGHT_BYTES = 33_080;
const TOPOLOGY_RETAINED_BUDGET_BYTES = 16 * 1024 * 1024;
const RENDERER_DELTA_BUDGET_BYTES = 128 * 1024;
const CAP_ALLOCATION_BUDGET_BYTES = 1024 * 1024;

type Workflow = NonNullable<WebGpuBenchmarkCaseResult["selectionHideWorkflow"]>;
type WorkflowVariant = Workflow["variants"][number];
type WorkflowPhase = WorkflowVariant["hide"];

/** Verifies select-half, hide-half, active-section, and restore evidence for the large solid case. */
export function expectSelectionHideWorkflow(entry: WebGpuBenchmarkCaseResult): void {
  if (entry.id !== "fe-tet4-solid-132k") return;
  const workflow = entry.selectionHideWorkflow;
  expect(workflow).toBeDefined();
  if (workflow === undefined) throw new Error(`${entry.id} selection-hide workflow is missing`);
  expect(workflow.nodes).toBe(true);
  expect(workflow.authoredEdges).toBe(true);
  expect(workflow.selectedElementCount).toBe(Math.ceil(entry.uniqueElementCount / 2));
  expect(workflow.selectedOccurrenceCount).toBe(1);
  expect(workflow.variants.map((variant) => variant.id)).toEqual(["unsectioned", "active-section"]);
  const unsectioned = workflow.variants[0];
  const active = workflow.variants[1];
  if (unsectioned === undefined || active === undefined)
    throw new Error("workflow variants are missing");
  expectWorkflowVariant(unsectioned, entry.uniqueElementCount, UNSECTIONED_SYNC_BUDGET_MS, 33.3);
  expectWorkflowVariant(
    active,
    entry.uniqueElementCount,
    ACTIVE_SECTION_SYNC_BUDGET_MS,
    ACTIVE_SECTION_FIRST_FRAME_BUDGET_MS,
  );
  expect(active.presentationGpuCost.draws["opaque"]?.indices ?? 0).toBeGreaterThan(
    unsectioned.presentationGpuCost.draws["opaque"]?.indices ?? 0,
  );
  expect(active.presentationGpuCost.memory.allocatedBytes).toBeGreaterThan(0);
  expect(active.presentationGpuCost.memory.allocatedBytes).toBeLessThan(
    CAP_ALLOCATION_BUDGET_BYTES,
  );
}

function expectWorkflowVariant(
  variant: WorkflowVariant,
  elementCount: number,
  syncBudgetMs: number,
  firstFrameBudgetMs: number,
): void {
  expect(variant.presentationGpuCost.draws["edges"]?.instances ?? 0).toBeGreaterThan(0);
  expect(variant.presentationGpuCost.draws["nodes"]?.instances ?? 0).toBeGreaterThan(0);
  expect(variant.selection.highlightRetainedBytes).toBe(TET4_SELECTION_HIGHLIGHT_BYTES);
  expect(variant.hide.highlightRetainedBytes).toBe(TET4_HIDE_HIGHLIGHT_BYTES);
  expect(variant.hide.topologyRetainedBytes).toBe(variant.selection.topologyRetainedBytes);
  expect(variant.restoredVisibleElementCount).toBe(elementCount);
  expectWorkflowPhase(variant.selection, syncBudgetMs, firstFrameBudgetMs);
  expectWorkflowPhase(variant.hide, syncBudgetMs, firstFrameBudgetMs);
}

function expectWorkflowPhase(
  phase: WorkflowPhase,
  syncBudgetMs: number,
  firstFrameBudgetMs: number,
): void {
  expect(phase.interactionStateMs).toBeLessThan(HALF_STATE_BUDGET_MS);
  expect(phase.interactionSyncMs).toBeLessThan(syncBudgetMs);
  expect(phase.topologyRetainedBytes).toBeGreaterThan(0);
  expect(phase.topologyRetainedBytes).toBeLessThan(TOPOLOGY_RETAINED_BUDGET_BYTES);
  expect(phase.rendererMemoryDeltaBytes).toBeLessThan(RENDERER_DELTA_BUDGET_BYTES);
  expect(phase.frames.firstFrameMs).toBeLessThan(firstFrameBudgetMs);
  expect(phase.frames.steadyFrameMs.p95).toBeGreaterThanOrEqual(phase.frames.steadyFrameMs.p50);
  expect(phase.frames.steadyFrameMs.p95).toBeLessThanOrEqual(STEADY_FRAME_BUDGET_MS);
  expect(phase.frames.movingFirstFrameMs).toBeLessThan(firstFrameBudgetMs);
  expect(phase.frames.movingSteadyFrameMs.p95).toBeGreaterThanOrEqual(
    phase.frames.movingSteadyFrameMs.p50,
  );
  expect(phase.frames.movingSteadyFrameMs.p95).toBeLessThanOrEqual(STEADY_FRAME_BUDGET_MS);
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
