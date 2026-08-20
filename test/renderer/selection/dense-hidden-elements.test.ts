import { describe, expect, it } from "vitest";
import { createElement } from "../../../src/elements/element";
import { createElementModel } from "../../../src/elements/model";
import { ElementShape } from "../../../src/elements/shapes";
import { createPartFromElementModel } from "../../../src/geometry/element-model-part";
import { setElementVisible } from "../../../src/interaction/elements";
import { createInteractionState } from "../../../src/interaction/interaction";
import { identityMatrix } from "../../../src/math/mat4";
import { buildPackedNodeTopologyData } from "../../../src/renderer/picking/node-topology";
import {
  collectDenseHiddenElements,
  denseSelectionContains,
} from "../../../src/renderer/selection/element-selection";
import { collectEmphasisUpdates } from "../../../src/renderer/resources/element-resources";
import { buildInstanceLayout } from "../../../src/renderer/runtime-state";
import { createPackedSceneRuntime } from "../../../src/scene-runtime/runtime";
import { createSceneBuilder } from "../../../src/scene/scene";

describe("dense hidden elements", () => {
  it("packs non-contiguous Tet4 and Hex8 ids by ordinal without sparse hidden records", () => {
    const part = tetAndHexPart();
    const scene = createSceneBuilder()
      .addPart(part)
      .addAssembly({
        id: 1,
        name: "root",
        placements: [{ kind: "part", partId: part.id, transform: identityMatrix() }],
      })
      .setRootAssembly(1)
      .build();
    const runtime = createPackedSceneRuntime(scene);
    const layout = buildInstanceLayout(runtime);
    const partOccurrenceId = runtime.getInstanceId(0);
    if (partOccurrenceId === undefined)
      throw new Error("Dense visibility fixture has no placement");
    let interaction = createInteractionState();
    interaction = setElementVisible(interaction, { partOccurrenceId, elementId: 101 }, false);
    interaction = setElementVisible(interaction, { partOccurrenceId, elementId: 90_001 }, false);
    const parts = new Map([[part.id, part]]);
    const hidden = collectDenseHiddenElements(runtime, layout, parts, interaction).get(part.id);
    if (hidden === undefined) throw new Error("Broad hidden elements did not use dense membership");

    expect(hidden.occurrences).toHaveLength(1);
    expect(denseSelectionContains(hidden, 0, 1)).toBe(true);
    expect(denseSelectionContains(hidden, 0, 2)).toBe(true);
    expect(
      collectEmphasisUpdates(runtime, layout, new Map([[partOccurrenceId, 0]]), {
        parts,
        interaction,
        denseHidden: new Map([[part.id, hidden]]),
      }).get(part.id),
    ).toBeUndefined();

    const topology = buildPackedNodeTopologyData(part);
    const conditions = topology[2] ?? 0;
    const ordinalOffset = 4 + (topology[0] ?? 0) * 5 + (topology[1] ?? 0) * 2 + conditions * 4;
    expect(
      new Set(topology.slice(ordinalOffset, ordinalOffset + conditions * 2).filter(Boolean)),
    ).toEqual(new Set([1, 2]));
  });
});

function tetAndHexPart() {
  const tetNodes = [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1];
  const hexNodes = [3, 0, 0, 4, 0, 0, 4, 1, 0, 3, 1, 0, 3, 0, 1, 4, 0, 1, 4, 1, 1, 3, 1, 1];
  return createPartFromElementModel(
    7,
    createElementModel(
      [...tetNodes, ...hexNodes],
      [
        createElement(101, ElementShape.Tet4, [0, 1, 2, 3]),
        createElement(90_001, ElementShape.Hex8, [4, 5, 6, 7, 8, 9, 10, 11]),
      ],
    ),
  );
}
