import { expect, it, describe } from "vitest";
import {
  createPart,
  createInteractionState,
  setElementHighlighted,
  setElementOverride,
  setElementSelected,
  setFaceSelected,
  setEdgeSelected,
  setNodeSelected,
  setTargetHovered,
  translation,
  createPackedSceneRuntime,
  createScene,
  collectEmphasisUpdates,
  buildInstanceLayout,
  elementScene,
  partsMap,
} from "./support";

describe("collectEmphasisUpdates", () => {
  it("maps semantic element highlights to the same GPU records", () => {
    const { scene, runtime } = elementScene();
    const layout = buildInstanceLayout(runtime);
    const interaction = setElementHighlighted(
      createInteractionState(),
      { instanceId: "1/0", elementId: 0 },
      true,
    );
    const updates = collectEmphasisUpdates(runtime, layout, new Map([["1/0", 0]]), {
      parts: partsMap(scene),
      interaction,
    });
    expect(updates.get(1)).toMatchObject([{ slot: 0, elementPickId: 1 }]);
  });

  it("maps selected edges through the rendered resource keys", () => {
    const { scene, runtime } = elementScene();
    const interaction = setEdgeSelected(
      createInteractionState(),
      { instanceId: "1/0", key: "0,2" },
      true,
    );
    const updates = collectEmphasisUpdates(
      runtime,
      buildInstanceLayout(runtime),
      new Map([["1/0", 0]]),
      {
        parts: partsMap(scene),
        interaction,
        edgeKeysByPart: new Map([[1, ["0,2"]]]),
      },
    );
    expect(updates.get(1)).toMatchObject([{ edgePickId: 1, selected: true }]);
  });

  it("maps a selected point node without element ownership", () => {
    const point = createPart(2, {
      geometries: [
        {
          positions: new Float32Array([0, 0, 0]),
          indices: new Uint32Array([0]),
          primitive: "points",
          nodePickIds: new Uint32Array([1]),
        },
      ],
      nodePositions: new Float32Array([0, 0, 0]),
    });
    const scene = createScene()
      .addPart(point)
      .addAssembly({
        id: 1,
        name: "standalone-node",
        placements: [{ kind: "part", partId: 2, transform: translation(0, 0, 0) }],
      })
      .withRoot(1)
      .build();
    const runtime = createPackedSceneRuntime(scene);
    const layout = buildInstanceLayout(runtime);
    const interaction = setNodeSelected(
      createInteractionState(),
      { instanceId: "1/0", nodeId: 0 },
      true,
    );

    expect(
      collectEmphasisUpdates(runtime, layout, new Map([["1/0", 0]]), {
        parts: new Map([[point.id, point]]),
        interaction,
      }).get(point.id),
    ).toMatchObject([{ slot: 0, elementPickId: 0, nodePickId: 1, selected: true }]);
  });

  it("maps emphasized face and node occurrences to face and node records", () => {
    const { scene, runtime } = elementScene();
    const layout = buildInstanceLayout(runtime);
    const slotByInstanceId = new Map([
      ["1/0", 0],
      ["1/1", 1],
    ]);
    let interaction = createInteractionState();
    interaction = setFaceSelected(
      interaction,
      { instanceId: "1/0", elementId: 0, faceIndex: 1 },
      true,
    );
    interaction = setNodeSelected(interaction, { instanceId: "1/1", nodeId: 2 }, true);
    const updates = collectEmphasisUpdates(runtime, layout, slotByInstanceId, {
      parts: partsMap(scene),
      interaction,
    });
    const list = updates.get(1) ?? [];
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ slot: 0, facePickId: 2, selected: true });
    expect(list[1]).toMatchObject({ slot: 1, nodePickId: 3, selected: true });
  });

  it("drops face refs whose face is absent from the part geometry", () => {
    const { scene, runtime } = elementScene();
    const layout = buildInstanceLayout(runtime);
    const slotByInstanceId = new Map([["1/0", 0]]);
    let interaction = createInteractionState();
    interaction = setFaceSelected(
      interaction,
      { instanceId: "1/0", elementId: 0, faceIndex: 9 },
      true,
    );
    const updates = collectEmphasisUpdates(runtime, layout, slotByInstanceId, {
      parts: partsMap(scene),
      interaction,
    });
    expect(updates.get(1) ?? []).toEqual([]);
  });

  it("combines hover, selection, and overrides in deterministic order", () => {
    const { scene, runtime } = elementScene();
    const layout = buildInstanceLayout(runtime);
    const slotByInstanceId = new Map([
      ["1/0", 0],
      ["1/1", 1],
    ]);
    let interaction = createInteractionState();
    interaction = setElementSelected(interaction, { instanceId: "1/0", elementId: 0 }, true);
    interaction = setElementOverride(
      interaction,
      { instanceId: "1/1", elementId: 0 },
      {
        emissive: 0.9,
      },
    );
    interaction = setTargetHovered(interaction, {
      kind: "element",
      instanceId: "1/0",
      elementId: 0,
    });
    const updates = collectEmphasisUpdates(runtime, layout, slotByInstanceId, {
      parts: partsMap(scene),
      interaction,
    });
    expect((updates.get(1) ?? []).map((update) => update.slot)).toEqual([0, 1]);
  });

  it("drops refs whose instance is unknown or hidden from the layout", () => {
    const { scene, runtime } = elementScene();
    const layout = buildInstanceLayout(runtime);
    const slotByInstanceId = new Map([["1/0", 0]]);
    let interaction = createInteractionState();
    interaction = setElementSelected(interaction, { instanceId: "1/0", elementId: 0 }, true);
    interaction = setElementSelected(interaction, { instanceId: "stale", elementId: 0 }, true);
    const updates = collectEmphasisUpdates(runtime, layout, slotByInstanceId, {
      parts: partsMap(scene),
      interaction,
    });
    expect((updates.get(1) ?? []).map((update) => update.slot)).toEqual([0]);
  });
});
