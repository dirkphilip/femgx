import { expect } from "@playwright/test";
import type { WebGpuBenchmarkCaseResult } from "../../demo/benchmark/types";

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
