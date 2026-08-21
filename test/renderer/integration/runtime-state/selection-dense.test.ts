import { describe, expect, it } from "vitest";
import {
  buildInstanceLayout,
  buildSelectionDrawCallsForTest,
  buildSelectionOrder,
  createInteractionState,
  createPackedSceneRuntime,
  createSceneBuilder,
  denseSelectionPart,
  identityMatrix,
  setTargetsSelected,
} from "./support";

describe("renderer runtime state dense selection", () => {
  it("builds one selected-region skin when a dense selection omits an element", () => {
    const scene = createSceneBuilder()
      .addPart(denseSelectionPart)
      .addAssembly({
        id: 1,
        name: "root",
        placements: [
          {
            kind: "part",
            placementId: "0",
            partId: denseSelectionPart.id,
            transform: identityMatrix(),
          },
        ],
      })
      .setRootAssembly(1)
      .build();
    const runtime = createPackedSceneRuntime(scene);
    const layout = buildInstanceLayout(runtime);
    const interaction = setTargetsSelected(
      createInteractionState(),
      [101, 102].map((elementId) => ({
        kind: "element" as const,
        partOccurrenceId: "1/0",
        elementId,
      })),
      true,
    );
    const order = buildSelectionOrder(
      layout,
      runtime,
      denseSelectionPart.id,
      interaction,
      new Map([[denseSelectionPart.id, denseSelectionPart]]),
    );

    expect(
      buildSelectionDrawCallsForTest({
        layout,
        runtime,
        partId: denseSelectionPart.id,
        interaction,
        part: denseSelectionPart,
        order,
      }),
    ).toEqual([
      { partId: denseSelectionPart.id, instanceCount: 1, firstInstance: 0, surfaceSubset: true },
      {
        partId: denseSelectionPart.id,
        instanceCount: 1,
        firstInstance: 0,
        surfaceSubset: true,
        selectionRanges: [{ primitive: "triangles", firstIndex: 9, indexCount: 3 }],
      },
    ]);
  });
});
