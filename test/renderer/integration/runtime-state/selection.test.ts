import { expect, it, describe } from "vitest";
import {
  identityMatrix,
  createPackedSceneRuntime,
  createSceneBuilder,
  buildDrawOrder,
  buildSelectionOrder,
  buildInstanceLayout,
  buildTransparentOrder,
  createInteractionState,
  setElementSelected,
  setPartOccurrenceSelected,
  setPartSelected,
  setFaceSelected,
  setNodeSelected,
  setTargetsSelected,
  buildSelectionDrawCallsForTest,
  part,
  rangedSelectionPart,
  interiorSubsetPart,
  fragmentedSelectionPart,
} from "./support";

describe("renderer runtime state", () => {
  it("keeps transparent classification in a separate visible order", () => {
    const scene = createSceneBuilder()
      .addPart(part(1))
      .addAssembly({
        id: 1,
        name: "root",
        placements: [
          {
            kind: "part",
            placementId: "0",
            partId: 1,
            transform: identityMatrix(),
          },
          {
            kind: "part",
            placementId: "1",
            partId: 1,
            transform: identityMatrix(),
          },
        ],
      })
      .setRootAssembly(1)
      .build();
    const runtime = createPackedSceneRuntime(scene);
    const layout = buildInstanceLayout(runtime);
    expect(Array.from(buildDrawOrder(layout, runtime, 1))).toEqual([0, 1]);
    expect(Array.from(buildTransparentOrder(layout, runtime, 1, [false, true]))).toEqual([1]);
  });

  it("compacts selected instances and selected-node instances independently", () => {
    const triangle = part(1);
    const scene = createSceneBuilder()
      .addPart(triangle)
      .addAssembly({
        id: 1,
        name: "root",
        placements: [
          {
            kind: "part",
            placementId: "0",
            partId: 1,
            transform: identityMatrix(),
          },
          {
            kind: "part",
            placementId: "1",
            partId: 1,
            transform: identityMatrix(),
          },
          {
            kind: "part",
            placementId: "2",
            partId: 1,
            transform: identityMatrix(),
          },
        ],
      })
      .setRootAssembly(1)
      .build();
    const runtime = createPackedSceneRuntime(scene);
    const layout = buildInstanceLayout(runtime);
    let interaction = setPartSelected(createInteractionState(), 1, true);
    interaction = setNodeSelected(interaction, { partOccurrenceId: "1/1", nodeId: 2 }, true);
    interaction = setPartOccurrenceSelected(interaction, "1/2", true);
    runtime.setInstanceVisible(1, false);
    const parts = new Map([[1, triangle]]);

    expect(Array.from(buildSelectionOrder(layout, runtime, 1, interaction, parts))).toEqual([0, 2]);
    runtime.setInstanceVisible(1, true);
  });

  it("builds exact ranged selection calls for omitted and explicit face-subset selection", () => {
    const scene = createSceneBuilder()
      .addPart(rangedSelectionPart)
      .addAssembly({
        id: 1,
        name: "root",
        placements: [
          {
            kind: "part",
            placementId: "0",
            partId: rangedSelectionPart.id,
            transform: identityMatrix(),
          },
        ],
      })
      .setRootAssembly(1)
      .build();
    const runtime = createPackedSceneRuntime(scene);
    const layout = buildInstanceLayout(runtime);
    const selectedElement = setElementSelected(
      createInteractionState(),
      { partOccurrenceId: "1/0", elementId: 102 },
      true,
    );
    const rangedParts = new Map([[rangedSelectionPart.id, rangedSelectionPart]]);
    const order = buildSelectionOrder(
      layout,
      runtime,
      rangedSelectionPart.id,
      selectedElement,
      rangedParts,
    );
    expect(
      buildSelectionDrawCallsForTest({
        layout,
        runtime,
        partId: rangedSelectionPart.id,
        interaction: selectedElement,
        part: rangedSelectionPart,
        order,
      }),
    ).toEqual([
      {
        partId: rangedSelectionPart.id,
        instanceCount: 1,
        firstInstance: 0,
        selectionRanges: [{ primitive: "triangles", firstIndex: 3, indexCount: 3 }],
      },
    ]);
    const selectedFace = setFaceSelected(
      createInteractionState(),
      { partOccurrenceId: "1/0", elementId: 103, faceIndex: 0 },
      true,
    );
    const faceOrder = buildSelectionOrder(
      layout,
      runtime,
      rangedSelectionPart.id,
      selectedFace,
      rangedParts,
    );
    expect(
      buildSelectionDrawCallsForTest({
        layout,
        runtime,
        partId: rangedSelectionPart.id,
        interaction: selectedFace,
        part: rangedSelectionPart,
        order: faceOrder,
      }),
    ).toEqual([
      {
        partId: rangedSelectionPart.id,
        instanceCount: 1,
        firstInstance: 0,
        selectionRanges: [{ primitive: "triangles", firstIndex: 6, indexCount: 3 }],
      },
    ]);
    const selectedInstance = setPartOccurrenceSelected(createInteractionState(), "1/0", true);
    const instanceOrder = buildSelectionOrder(
      layout,
      runtime,
      rangedSelectionPart.id,
      selectedInstance,
      rangedParts,
    );
    expect(
      buildSelectionDrawCallsForTest({
        layout,
        runtime,
        partId: rangedSelectionPart.id,
        interaction: selectedInstance,
        part: rangedSelectionPart,
        order: instanceOrder,
      }),
    ).toBeUndefined();

    const allElements = setTargetsSelected(
      createInteractionState(),
      [101, 102, 103].map((elementId) => ({
        kind: "element" as const,
        partOccurrenceId: "1/0",
        elementId,
      })),
      true,
    );
    const allElementOrder = buildSelectionOrder(
      layout,
      runtime,
      rangedSelectionPart.id,
      allElements,
      rangedParts,
    );
    expect(
      buildSelectionDrawCallsForTest({
        layout,
        runtime,
        partId: rangedSelectionPart.id,
        interaction: allElements,
        part: rangedSelectionPart,
        order: allElementOrder,
      }),
    ).toEqual([
      {
        partId: rangedSelectionPart.id,
        instanceCount: 1,
        firstInstance: 0,
        surfaceSubset: true,
      },
    ]);
    const allElementsAndFace = setFaceSelected(
      allElements,
      { partOccurrenceId: "1/0", elementId: 103, faceIndex: 0 },
      true,
    );
    expect(
      buildSelectionDrawCallsForTest({
        layout,
        runtime,
        partId: rangedSelectionPart.id,
        interaction: allElementsAndFace,
        part: rangedSelectionPart,
        order: allElementOrder,
      }),
    ).toEqual([
      {
        partId: rangedSelectionPart.id,
        instanceCount: 1,
        firstInstance: 0,
        selectionRanges: [{ primitive: "triangles", firstIndex: 0, indexCount: 9 }],
      },
    ]);
    const allElementsAndUnknown = setElementSelected(
      allElements,
      { partOccurrenceId: "1/0", elementId: 999 },
      true,
    );
    expect(
      buildSelectionDrawCallsForTest({
        layout,
        runtime,
        partId: rangedSelectionPart.id,
        interaction: allElementsAndUnknown,
        part: rangedSelectionPart,
        order: allElementOrder,
      }),
    ).toBeUndefined();

    runtime.setInstanceVisible(0, false);
    expect(
      buildSelectionOrder(layout, runtime, rangedSelectionPart.id, selectedInstance, rangedParts),
    ).toEqual(new Uint32Array());
    runtime.setInstanceVisible(0, true);
    const staleElement = setElementSelected(
      createInteractionState(),
      { partOccurrenceId: "1/9", elementId: 7 },
      true,
    );
    expect(
      buildSelectionOrder(layout, runtime, rangedSelectionPart.id, staleElement, rangedParts),
    ).toEqual(new Uint32Array());
  });

  it("falls back when one grouped instance would issue too many range draws", () => {
    const scene = createSceneBuilder()
      .addPart(fragmentedSelectionPart)
      .addAssembly({
        id: 1,
        name: "root",
        placements: [
          {
            kind: "part",
            placementId: "0",
            partId: fragmentedSelectionPart.id,
            transform: identityMatrix(),
          },
        ],
      })
      .setRootAssembly(1)
      .build();
    const runtime = createPackedSceneRuntime(scene);
    const layout = buildInstanceLayout(runtime);
    const targets = Array.from({ length: 1025 }, (_, index) => ({
      kind: "element" as const,
      partOccurrenceId: "1/0",
      elementId: index * 2 + 1,
    }));
    const interaction = setTargetsSelected(createInteractionState(), targets, true);
    const order = buildSelectionOrder(
      layout,
      runtime,
      fragmentedSelectionPart.id,
      interaction,
      new Map([[fragmentedSelectionPart.id, fragmentedSelectionPart]]),
    );

    expect(
      buildSelectionDrawCallsForTest({
        layout,
        runtime,
        partId: fragmentedSelectionPart.id,
        interaction,
        part: fragmentedSelectionPart,
        order,
      }),
    ).toBeUndefined();
  });

  it("retains interior faces when every element in an explicit face subset is selected", () => {
    const scene = createSceneBuilder()
      .addPart(interiorSubsetPart)
      .addAssembly({
        id: 1,
        name: "root",
        placements: [
          {
            kind: "part",
            placementId: "0",
            partId: interiorSubsetPart.id,
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
      [101, 102, 103].map((elementId) => ({
        kind: "element" as const,
        partOccurrenceId: "1/0",
        elementId,
      })),
      true,
    );
    const order = buildSelectionOrder(
      layout,
      runtime,
      interiorSubsetPart.id,
      interaction,
      new Map([[interiorSubsetPart.id, interiorSubsetPart]]),
    );

    expect(
      buildSelectionDrawCallsForTest({
        layout,
        runtime,
        partId: interiorSubsetPart.id,
        interaction,
        part: interiorSubsetPart,
        order,
      }),
    ).toEqual([
      {
        partId: interiorSubsetPart.id,
        instanceCount: 1,
        firstInstance: 0,
        selectionRanges: [{ primitive: "triangles", firstIndex: 0, indexCount: 18 }],
      },
    ]);
  });
});
