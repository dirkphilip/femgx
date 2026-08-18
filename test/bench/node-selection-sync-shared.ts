import { readInteractionState } from "../../src/interaction/state";
import type { InteractionState } from "../../src/interaction/state";
import type { NodeCase, NodeSelectionFixture } from "./node-selection-sync-operation";
import { buildHighlightTable } from "../../src/renderer/selection/highlight-table";
import { toHighlightTableEntry } from "../../src/renderer/selection/highlight-storage";
import type { createPackedSceneRuntime } from "../../src/scene-runtime/runtime";
import {
  ELEMENT_RECORD_STRIDE,
  HIGHLIGHT_HEADER,
} from "../../src/renderer/selection/highlight-layout";
import type { DrawResources } from "../../src/renderer/resources/draw-resources";

export const ELEMENT_COUNT = 131_712;
export const NODE_COUNT = 24_389;
export const HALF_NODE_COUNT = Math.floor(NODE_COUNT / 2);
export const PART_ID = 1;
export const SAMPLE_COUNT = 9;
export const CASES = ["small", "half", "all"] as const;
export type CaseId = (typeof CASES)[number];
export const MULTI_CASE_ID = "multi-32x1" as const;

/** Maps packed runtime instance identities to their slots for the benchmark fixture. */
export function slotMap(
  runtime: ReturnType<typeof createPackedSceneRuntime>,
): ReadonlyMap<string, number> {
  const slots = new Map<string, number>();
  for (let slot = 0; slot < runtime.instanceCount; slot += 1) {
    const partOccurrenceId = runtime.getInstanceId(slot);
    if (partOccurrenceId !== undefined) slots.set(partOccurrenceId, slot);
  }
  return slots;
}

/** Returns the packed runtime instance identities in slot order. */
export function runtimeInstanceIds(
  runtime: ReturnType<typeof createPackedSceneRuntime>,
): readonly string[] {
  const ids: string[] = [];
  for (let slot = 0; slot < runtime.instanceCount; slot += 1) {
    const partOccurrenceId = runtime.getInstanceId(slot);
    if (partOccurrenceId !== undefined) ids.push(partOccurrenceId);
  }
  return ids;
}

/** Returns the occurrence flags used by selected-node order construction. */
export function selectedFlags(
  fixture: NodeSelectionFixture,
  interaction: InteractionState,
): boolean[] {
  const data = readInteractionState(interaction);
  return Array.from({ length: fixture.runtime.instanceCount }, (_, slot) => {
    const partOccurrenceId = fixture.runtime.getInstanceId(slot);
    return (
      partOccurrenceId !== undefined && (data.selectedNodeIds.get(partOccurrenceId)?.size ?? 0) > 0
    );
  });
}

/** Reports the dense node slot-table and bitset bytes for one benchmark case. */
export function denseNodeBytes(fixture: NodeSelectionFixture, selected: NodeCase): number {
  const selection = selected.denseNodeSelections.get(PART_ID);
  if (selection === undefined) return 0;
  const slots = fixture.layout.partSlots.get(PART_ID)?.length ?? 0;
  const words = Math.ceil(selection.nodeCount / 32);
  return (
    slots * Uint32Array.BYTES_PER_ELEMENT +
    selection.occurrences.length * words * Uint32Array.BYTES_PER_ELEMENT
  );
}

/** Reports the full fresh highlight allocation, including retained sparse capacity. */
export function highlightStorageBytes(fixture: NodeSelectionFixture, selected: NodeCase): number {
  const updates = selected.emphasisUpdates.get(PART_ID) ?? [];
  const table = buildHighlightTable(updates.map(toHighlightTableEntry));
  const sparseCapacity = Math.max(1, table.entries.length);
  return (
    HIGHLIGHT_HEADER + sparseCapacity * ELEMENT_RECORD_STRIDE + denseNodeBytes(fixture, selected)
  );
}

/** Returns the actual sparse hash-table bytes retained by a fresh allocation. */
export function sparseHighlightTableBytes(selected: NodeCase): number {
  const updates = selected.emphasisUpdates.get(PART_ID) ?? [];
  const table = buildHighlightTable(updates.map(toHighlightTableEntry));
  return Math.max(1, table.entries.length) * ELEMENT_RECORD_STRIDE;
}

/** Builds stable workload and storage details for an operation report. */
export function details(
  fixture: NodeSelectionFixture,
  selected: NodeCase,
): Readonly<Record<string, number>> {
  const selectedOccurrenceCount = selectedFlags(fixture, selected.interaction).filter(
    Boolean,
  ).length;
  return {
    selectedNodes: selected.selectedNodeCount,
    selectedOccurrenceCount,
    occurrenceCount: fixture.runtime.instanceCount,
    nodeCount: fixture.nodeCount,
    elementCount: fixture.elementCount,
    authoredFaceCount: fixture.authoredFaceCount,
    boundaryFaceCount: fixture.boundaryFaceCount,
    nodePositionsBytes: fixture.nodePositionsBytes,
    nodePickIdsBytes: fixture.nodePickIdsBytes,
    nodeSpriteVertexCount: fixture.nodeCount * 4,
    nodeSpriteIndexCount: fixture.nodeCount * 6,
    selectedNodeDrawIndexCount: selectedOccurrenceCount * fixture.nodeCount * 6,
    denseSelectionBytes: denseNodeBytes(fixture, selected),
    sparseHighlightTableBytes: sparseHighlightTableBytes(selected),
  };
}

/** Asserts that one benchmark target retains its selected-node count. */
export function assertNodeSelection(
  interaction: InteractionState,
  partOccurrenceId: string,
  expected: number,
): void {
  const actual = readInteractionState(interaction).selectedNodeIds.get(partOccurrenceId)?.size ?? 0;
  if (actual !== expected)
    throw new Error(`Node selection changed: expected ${expected}, got ${actual}`);
}

/** Asserts the total selected-node count across all occurrences. */
export function assertSelectedNodeTotal(interaction: InteractionState, expected: number): void {
  let actual = 0;
  for (const ids of readInteractionState(interaction).selectedNodeIds.values()) actual += ids.size;
  if (actual !== expected)
    throw new Error(`Node selection changed: expected ${expected}, got ${actual}`);
}

/** Asserts the selected flags plus both node order sidecars after a cold sync. */
export function assertNodeSync(
  actualFlags: readonly boolean[],
  draw: DrawResources,
  expectedFlags: readonly boolean[],
  expectedOrder: Uint32Array,
): void {
  if (
    actualFlags.length !== expectedFlags.length ||
    actualFlags.some((value, index) => value !== expectedFlags[index])
  ) {
    throw new Error("Selected-node flags changed");
  }
  const storage = draw.storages.get(PART_ID);
  assertOrder(storage?.sidecars.node, expectedOrder, "node visibility");
  assertOrder(storage?.sidecars.nodeSelection, expectedOrder, "selected node");
}

function assertOrder(
  actual: { readonly data: Uint32Array; readonly length: number } | undefined,
  expected: Uint32Array,
  label: string,
): void {
  if (
    actual === undefined ||
    actual.length !== expected.length ||
    expected.some((value, index) => value !== actual.data[index])
  ) {
    throw new Error(`${label} order changed`);
  }
}
