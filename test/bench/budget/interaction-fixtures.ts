import { createPart, translation, type Part } from "../../../src/entries/root";
import {
  createInteractionState,
  setTargetsSelected,
  type InteractionTarget,
} from "../../../src/entries/interaction";
import { buildInstanceLayout } from "../../../src/renderer/runtime-state";
import { createPackedSceneRuntime } from "../../../src/scene-runtime/runtime";
import { collectDenseElementSelections } from "../../../src/renderer/selection/element-selection";
import { getPartSemanticIndex } from "../../../src/geometry/part-semantic-index";
import { defaultStyle } from "../../../src/renderer/resources/foundation";
import { encodeEmphasisRecord } from "../../../src/renderer/resources/element-resources";
import type { HighlightTableEntry } from "../../../src/renderer/selection/highlight-table";
import { BENCH_BODY_ELEMENT_COUNT } from "../fixtures";
import { bodyGeometry } from "./geometry-fixtures";

const emphasisPart = createPart(907, {
  geometries: [bodyGeometry.geometry],
  elements: bodyGeometry.elements,
  nodePositions: bodyGeometry.nodePositions,
  ...(bodyGeometry.bodies === undefined ? {} : { bodies: bodyGeometry.bodies }),
});
getPartSemanticIndex(emphasisPart);
const emphasisScene = {
  rootAssemblyId: 1,
  parts: new Map([[emphasisPart.id, emphasisPart]]),
  assemblies: new Map([
    [
      1,
      {
        id: 1,
        placements: [
          { kind: "part" as const, partId: emphasisPart.id, transform: translation(0, 0, 0) },
        ],
      },
    ],
  ]),
  visiblePartIds: new Set([emphasisPart.id]),
  visibleAssemblyIds: new Set([1]),
};
const emphasisRuntime = createPackedSceneRuntime(emphasisScene);
const emphasisLayout = buildInstanceLayout(emphasisRuntime);
const emphasisInstanceId = emphasisRuntime.getInstanceId(0);
if (emphasisInstanceId === undefined) throw new Error("Missing emphasis benchmark instance");
const emphasisSlotByInstanceId = new Map([[emphasisInstanceId, 0]]);
const emphasisElementIds = Array.from(
  { length: BENCH_BODY_ELEMENT_COUNT },
  (_, index) => index + 1,
);
const emphasisInteraction = setTargetsSelected(
  createInteractionState(),
  emphasisElementIds.map((elementId) => ({
    kind: "element" as const,
    partOccurrenceId: emphasisInstanceId,
    elementId,
  })),
  true,
);
const emphasisDenseSelections = collectDenseElementSelections(
  emphasisRuntime,
  emphasisLayout,
  emphasisScene.parts,
  emphasisInteraction,
);

const BULK_SELECTION_COUNT = 16_384;
const bulkSelectionTargets: InteractionTarget[] = Array.from(
  { length: BULK_SELECTION_COUNT },
  (_, index) => ({ kind: "element", partOccurrenceId: "bench/0", elementId: index + 1 }),
);
const TET4_SELECTION_COUNT = 131_712;
const tet4SelectionTargets = makeSelectionTargets(TET4_SELECTION_COUNT, 1);
const duplicateBulkSelectionTargets = [
  ...bulkSelectionTargets,
  ...bulkSelectionTargets.slice(0, 1_024),
];
const bulkHighlightTargets = bulkSelectionTargets.slice(0, 8_192);
const PHASE_SELECTION_COUNTS = [1, 1_024, 4_096, 16_384] as const;
const phaseSelectionTargets = new Map(
  PHASE_SELECTION_COUNTS.map((count) => [count, makeSelectionTargets(count, 2)]),
);
const phaseSelectionStates = new Map(
  PHASE_SELECTION_COUNTS.map((count) => {
    const targets = phaseSelectionTargets.get(count) ?? [];
    return [count, setTargetsSelected(createInteractionState(), targets, true)] as const;
  }),
);
const SCENE_BUILDER_PART_COUNT = 4_096;
const sceneBuilderParts: readonly Part[] = Array.from(
  { length: SCENE_BUILDER_PART_COUNT },
  (_, index) =>
    createPart(index + 1, {
      geometries: [
        {
          positions: new Float32Array([0, 0, 0]),
          indices: new Uint32Array(),
          primitive: "points",
        },
      ],
    }),
);
const emphasisTableEntries: HighlightTableEntry[] = Array.from(
  { length: BULK_SELECTION_COUNT },
  (_, index) => {
    const update = {
      slot: index % 64,
      elementPickId: index + 1,
      facePickId: 0,
      nodePickId: 0,
      style: defaultStyle,
    };
    return {
      slot: update.slot,
      elementPickId: update.elementPickId,
      facePickId: 0,
      nodePickId: 0,
      data: encodeEmphasisRecord(update),
    };
  },
);

/** Creates repeated-occurrence element identities for bulk interaction budgets. */
function makeSelectionTargets(count: number, occurrenceCount: number): InteractionTarget[] {
  return Array.from({ length: count }, (_, index) => ({
    kind: "element" as const,
    partOccurrenceId: `bench/${index % occurrenceCount}`,
    elementId: index + 1,
  }));
}

export {
  emphasisPart,
  emphasisScene,
  emphasisRuntime,
  emphasisLayout,
  emphasisInstanceId,
  emphasisSlotByInstanceId,
  emphasisElementIds,
  emphasisInteraction,
  emphasisDenseSelections,
  bulkSelectionTargets,
  duplicateBulkSelectionTargets,
  bulkHighlightTargets,
  tet4SelectionTargets,
  phaseSelectionTargets,
  phaseSelectionStates,
  sceneBuilderParts,
  emphasisTableEntries,
  makeSelectionTargets,
};
