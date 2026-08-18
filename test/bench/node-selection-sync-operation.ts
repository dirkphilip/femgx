import type { Part, PartId } from "../../src/geometry/part";
import type { InteractionState } from "../../src/interaction/interaction";
import type { InteractionTarget } from "../../src/interaction/target-types";
import type { buildInstanceLayout } from "../../src/renderer/runtime-state";
import type { createPackedSceneRuntime } from "../../src/scene-runtime/runtime";
import type { EmphasisUpdates } from "../../src/renderer/resources/element-resources";
import type { DenseNodeSelections } from "../../src/renderer/selection/node-selection";
import type { OperationSpec } from "./operation-report";
import { buildNodeSelectionCaseOperations } from "./node-selection-sync-operations";
import { nodeSpriteBufferOperation } from "./node-sprite-buffer-operation";
import { nodeTopologyOperation } from "./node-topology-operation";
import { CASES, type MULTI_CASE_ID } from "./node-selection-sync-shared";

export type CaseId = (typeof CASES)[number];
export type NodeCaseId = CaseId | typeof MULTI_CASE_ID;

export interface NodeCase {
  readonly id: NodeCaseId;
  readonly interaction: InteractionState;
  readonly targets: readonly InteractionTarget[];
  readonly selectedNodeCount: number;
  readonly denseNodeSelections: DenseNodeSelections;
  readonly emphasisUpdates: EmphasisUpdates;
}

export interface NodeSelectionFixture {
  readonly part: Part;
  readonly parts: ReadonlyMap<PartId, Part>;
  readonly runtime: ReturnType<typeof createPackedSceneRuntime>;
  readonly layout: ReturnType<typeof buildInstanceLayout>;
  readonly slotByInstanceId: ReadonlyMap<string, number>;
  readonly partOccurrenceIds: readonly string[];
  readonly nodeCount: number;
  readonly elementCount: number;
  readonly authoredFaceCount: number;
  readonly boundaryFaceCount: number;
  readonly nodePositionsBytes: number;
  readonly nodePickIdsBytes: number;
  readonly cases: ReadonlyMap<NodeCaseId, NodeCase>;
}

export { createNodeSelectionFixture } from "./node-selection-sync-fixture-builder";

/** Builds the opt-in node-selection operation matrix. */
export function nodeSelectionOperations(fixture: NodeSelectionFixture): readonly OperationSpec[] {
  return [
    nodeSpriteBufferOperation(fixture),
    nodeTopologyOperation(fixture),
    ...CASES.flatMap((id) => nodeSelectionCaseOperations(fixture, id)),
  ];
}

/** Returns the operation matrix for one selection case, including placements. */
export function nodeSelectionCaseOperations(
  fixture: NodeSelectionFixture,
  id: NodeCaseId,
): readonly OperationSpec[] {
  return buildNodeSelectionCaseOperations(fixture, id);
}
