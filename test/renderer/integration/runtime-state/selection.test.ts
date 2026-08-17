import { expect, it, describe } from "vitest";
import {
  identity,
  createPackedSceneRuntime,
  createScene,
  buildDrawOrder,
  buildNodeSelectionOrder,
  buildSelectionOrder,
  buildInstanceLayout,
  buildTransparentOrder,
  createInteractionState,
  setElementSelected,
  setInstanceSelected,
  setPartSelected,
  setFaceSelected,
  setNodeSelected,
  setTargetsSelected,
  buildSelectionDrawCalls,
  part,
  rangedSelectionPart,
  fragmentedSelectionPart,
} from "./support";

describe("renderer runtime state", () => {
  it("keeps transparent classification in a separate visible order", () => {
    const scene = createScene()
      .addPart(part(1))
      .addAssembly({
        id: 1,
        name: "root",
        placements: [
          { kind: "part", partId: 1, transform: identity() },
          { kind: "part", partId: 1, transform: identity() },
        ],
      })
      .withRoot(1)
      .build();
    const runtime = createPackedSceneRuntime(scene);
    const layout = buildInstanceLayout(runtime);
    expect(Array.from(buildDrawOrder(layout, runtime, 1))).toEqual([0, 1]);
    expect(Array.from(buildTransparentOrder(layout, runtime, 1, [false, true]))).toEqual([1]);
  });

  it("compacts selected instances and selected-node instances independently", () => {
    const triangle = part(1);
    const scene = createScene()
      .addPart(triangle)
      .addAssembly({
        id: 1,
        name: "root",
        placements: [
          { kind: "part", partId: 1, transform: identity() },
          { kind: "part", partId: 1, transform: identity() },
          { kind: "part", partId: 1, transform: identity() },
        ],
      })
      .withRoot(1)
      .build();
    const runtime = createPackedSceneRuntime(scene);
    const layout = buildInstanceLayout(runtime);
    let interaction = setPartSelected(createInteractionState(), 1, true);
    interaction = setNodeSelected(interaction, { instanceId: "1/1", nodeId: 2 }, true);
    interaction = setInstanceSelected(interaction, "1/2", true);
    runtime.setInstanceVisible(1, false);
    const parts = new Map([[1, triangle]]);

    expect(Array.from(buildSelectionOrder(layout, runtime, 1, interaction))).toEqual([0, 2]);
    expect(
      Array.from(buildNodeSelectionOrder(layout, runtime, 1, [false, true, false], parts)),
    ).toEqual([]);
    runtime.setInstanceVisible(1, true);
    expect(
      Array.from(buildNodeSelectionOrder(layout, runtime, 1, [false, true, false], parts)),
    ).toEqual([1]);
  });

  it("builds ranged selection calls for omitted face-subset elements and keeps broad selection fallback", () => {
    const scene = createScene()
      .addPart(rangedSelectionPart)
      .addAssembly({
        id: 1,
        name: "root",
        placements: [{ kind: "part", partId: rangedSelectionPart.id, transform: identity() }],
      })
      .withRoot(1)
      .build();
    const runtime = createPackedSceneRuntime(scene);
    const layout = buildInstanceLayout(runtime);
    const selectedElement = setElementSelected(
      createInteractionState(),
      { instanceId: "1/0", elementId: 102 },
      true,
    );
    const order = buildSelectionOrder(layout, runtime, rangedSelectionPart.id, selectedElement);
    expect(
      buildSelectionDrawCalls({
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
      { instanceId: "1/0", elementId: 103, faceIndex: 0 },
      true,
    );
    const faceOrder = buildSelectionOrder(layout, runtime, rangedSelectionPart.id, selectedFace);
    expect(
      buildSelectionDrawCalls({
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
    const selectedInstance = setInstanceSelected(createInteractionState(), "1/0", true);
    const instanceOrder = buildSelectionOrder(
      layout,
      runtime,
      rangedSelectionPart.id,
      selectedInstance,
    );
    expect(
      buildSelectionDrawCalls({
        layout,
        runtime,
        partId: rangedSelectionPart.id,
        interaction: selectedInstance,
        part: rangedSelectionPart,
        order: instanceOrder,
      }),
    ).toBeUndefined();

    runtime.setInstanceVisible(0, false);
    expect(buildSelectionOrder(layout, runtime, rangedSelectionPart.id, selectedInstance)).toEqual(
      new Uint32Array(),
    );
    runtime.setInstanceVisible(0, true);
    const staleElement = setElementSelected(
      createInteractionState(),
      { instanceId: "1/9", elementId: 7 },
      true,
    );
    expect(buildSelectionOrder(layout, runtime, rangedSelectionPart.id, staleElement)).toEqual(
      new Uint32Array(),
    );
  });

  it("falls back when one grouped instance would issue too many range draws", () => {
    const scene = createScene()
      .addPart(fragmentedSelectionPart)
      .addAssembly({
        id: 1,
        name: "root",
        placements: [{ kind: "part", partId: fragmentedSelectionPart.id, transform: identity() }],
      })
      .withRoot(1)
      .build();
    const runtime = createPackedSceneRuntime(scene);
    const layout = buildInstanceLayout(runtime);
    const targets = Array.from({ length: 1025 }, (_, index) => ({
      kind: "element" as const,
      instanceId: "1/0",
      elementId: index * 2 + 1,
    }));
    const interaction = setTargetsSelected(createInteractionState(), targets, true);
    const order = buildSelectionOrder(layout, runtime, fragmentedSelectionPart.id, interaction);

    expect(
      buildSelectionDrawCalls({
        layout,
        runtime,
        partId: fragmentedSelectionPart.id,
        interaction,
        part: fragmentedSelectionPart,
        order,
      }),
    ).toBeUndefined();
  });
});
