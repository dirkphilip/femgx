import { createInteractionState } from "../../src/interaction/interaction";
import { setTargetsSelected } from "../../src/interaction/targets";
import { translationMatrix } from "../../src/math/mat4";
import { collectEmphasisUpdates } from "../../src/renderer/resources/element-resources";
import { collectDenseNodeSelections } from "../../src/renderer/selection/node-selection";
import { buildInstanceLayout } from "../../src/renderer/runtime-state";
import { createPackedSceneRuntime } from "../../src/scene-runtime/runtime";
import { createSceneBuilder } from "../../src/scene/scene";
import { type NodeCase, type NodeSelectionFixture } from "./node-selection-sync-operation";
import { MULTI_CASE_ID, runtimeInstanceIds, slotMap } from "./node-selection-sync-shared";

const MULTI_OCCURRENCE_COUNT = 32;

/** Creates an additional 32-placement fixture for occurrence-scaling facts. */
export function createMultiPlacementNodeFixture(base: NodeSelectionFixture): NodeSelectionFixture {
  const scene = createSceneBuilder()
    .addPart(base.part)
    .addAssembly({
      id: 2,
      name: "node-selection-multi-placement",
      placements: Array.from({ length: MULTI_OCCURRENCE_COUNT }, (_, index) => ({
        kind: "part" as const,
        partId: base.part.id,
        placementId: `placement-${index}`,
        transform: translationMatrix(index * 2, 0, 0),
      })),
    })
    .setRootAssembly(2)
    .build();
  const runtime = createPackedSceneRuntime(scene);
  const layout = buildInstanceLayout(runtime);
  const partOccurrenceIds = runtimeInstanceIds(runtime);
  const targets = partOccurrenceIds.map((partOccurrenceId) => ({
    kind: "node" as const,
    partOccurrenceId,
    nodeId: 0,
  }));
  const interaction = setTargetsSelected(createInteractionState(), targets, true);
  const denseNodeSelections = collectDenseNodeSelections(runtime, layout, scene.parts, interaction);
  const emphasisUpdates = collectEmphasisUpdates(runtime, layout, slotMap(runtime), {
    parts: scene.parts,
    interaction,
    denseSelections: new Map(),
    denseNodeSelections,
  });
  const selectedNodeCase: NodeCase = {
    id: MULTI_CASE_ID,
    interaction,
    targets,
    selectedNodeCount: targets.length,
    denseNodeSelections,
    emphasisUpdates,
  };
  return {
    ...base,
    parts: scene.parts,
    runtime,
    layout,
    slotByInstanceId: slotMap(runtime),
    partOccurrenceIds,
    cases: new Map([[MULTI_CASE_ID, selectedNodeCase]]),
  };
}
