import { expect, it, describe } from "vitest";
import { setBodyHighlighted } from "../../../../src/interaction/bodies";
import {
  createPart,
  createInteractionState,
  setElementHighlighted,
  setElementOverride,
  setElementSelected,
  setBodyOverride,
  setBodySelected,
  setFaceSelected,
  setEdgeSelected,
  setNodeSelected,
  setTargetHovered,
  translationMatrix,
  createPackedSceneRuntime,
  createSceneBuilder,
  collectEmphasisUpdates,
  collectDenseElementSelections,
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
      { partOccurrenceId: "1/0", elementId: 0 },
      true,
    );
    const updates = collectEmphasisUpdates(runtime, layout, new Map([["1/0", 0]]), {
      parts: partsMap(scene),
      interaction,
    });
    expect(updates.get(1)).toMatchObject([{ slot: 0, elementPickId: 1, keepsResultColor: true }]);
  });

  it.each([
    {
      emphasis: "highlighted",
      override: { color: { r: 0.1, g: 0.2, b: 0.3, a: 0.8 } },
      expectedStyle: { color: { r: 0.1, g: 0.2, b: 0.3, a: 0.8 }, opacity: 1 },
      name: "highlighted color",
    },
    {
      emphasis: "highlighted",
      override: { opacity: 0.4 },
      expectedStyle: { color: { r: 0.23, g: 0.51, b: 0.96, a: 1 }, opacity: 0.4 },
      name: "highlighted opacity",
    },
    {
      emphasis: "hovered",
      override: { color: { r: 0.1, g: 0.2, b: 0.3, a: 0.8 } },
      expectedStyle: { color: { r: 0.1, g: 0.2, b: 0.3, a: 0.8 }, opacity: 1 },
      name: "hovered color",
    },
    {
      emphasis: "hovered",
      override: { opacity: 0.4 },
      expectedStyle: { color: { r: 0.23, g: 0.51, b: 0.96, a: 1 }, opacity: 0.4 },
      name: "hovered opacity",
    },
  ])(
    "does not keep scalar colors for unselected custom $name emphasis",
    ({ emphasis, override, expectedStyle }) => {
      for (const scope of ["body", "element"] as const) {
        const { scene, runtime } = elementScene();
        let interaction = createInteractionState({ highlighted: override, selected: {} });
        if (emphasis === "highlighted") {
          interaction =
            scope === "body"
              ? setBodyHighlighted(interaction, { partOccurrenceId: "1/0", bodyId: 3 }, true)
              : setElementHighlighted(interaction, { partOccurrenceId: "1/0", elementId: 0 }, true);
        } else {
          interaction = setTargetHovered(
            interaction,
            scope === "body"
              ? { kind: "body", partOccurrenceId: "1/0", bodyId: 3 }
              : { kind: "element", partOccurrenceId: "1/0", elementId: 0 },
          );
        }
        const updates = collectEmphasisUpdates(
          runtime,
          buildInstanceLayout(runtime),
          new Map([["1/0", 0]]),
          { parts: partsMap(scene), interaction },
        );
        const update = (updates.get(1) ?? []).find((candidate) =>
          scope === "body" ? candidate.bodyPickId === 4 : candidate.elementPickId === 1,
        );
        expect(update).toMatchObject({ keepsResultColor: false, style: expectedStyle });
      }
    },
  );

  it("keeps result colors for ordinary element selection", () => {
    const { scene, runtime } = elementScene();
    const interaction = setElementSelected(
      createInteractionState(),
      { partOccurrenceId: "1/0", elementId: 0 },
      true,
    );
    const updates = collectEmphasisUpdates(
      runtime,
      buildInstanceLayout(runtime),
      new Map([["1/0", 0]]),
      {
        parts: partsMap(scene),
        interaction,
      },
    );
    expect(updates.get(1)).toMatchObject([
      {
        selected: true,
        keepsResultColor: true,
        style: { color: { r: 0.95, g: 0.5, b: 0.1, a: 1 } },
      },
    ]);
  });

  it.each([
    {
      name: "color",
      override: { color: { r: 0.1, g: 0.2, b: 0.3, a: 0.8 } },
      expectedColor: { r: 0.1, g: 0.2, b: 0.3, a: 0.8 },
    },
    {
      name: "opacity",
      override: { opacity: 0.4 },
      expectedColor: { r: 0.95, g: 0.5, b: 0.1, a: 1 },
    },
  ])(
    "disables result colors for selected dense element $name overrides",
    ({ override, expectedColor }) => {
      const { scene, runtime } = elementScene();
      const layout = buildInstanceLayout(runtime);
      let interaction = setElementSelected(
        createInteractionState(),
        { partOccurrenceId: "1/0", elementId: 0 },
        true,
      );
      interaction = setElementOverride(
        interaction,
        { partOccurrenceId: "1/0", elementId: 0 },
        override,
      );
      const denseSelections = collectDenseElementSelections(
        runtime,
        layout,
        partsMap(scene),
        interaction,
      );
      const updates = collectEmphasisUpdates(runtime, layout, new Map([["1/0", 0]]), {
        parts: partsMap(scene),
        interaction,
        denseSelections,
      });
      expect(denseSelections.get(1)?.occurrences).toEqual([
        { slot: 0, selectedCount: 1, words: new Uint32Array([1]) },
      ]);
      expect(updates.get(1)).toMatchObject([
        {
          selected: true,
          keepsResultColor: false,
          elementPickId: 1,
          style: { color: expectedColor },
        },
      ]);
    },
  );

  it("keeps scalar colors for ordinary body selection while carrying selection color", () => {
    const { scene, runtime } = elementScene();
    const interaction = setBodySelected(
      createInteractionState(),
      { partOccurrenceId: "1/0", bodyId: 3 },
      true,
    );
    const updates = collectEmphasisUpdates(
      runtime,
      buildInstanceLayout(runtime),
      new Map([["1/0", 0]]),
      { parts: partsMap(scene), interaction },
    );
    expect(updates.get(1)).toMatchObject([
      {
        selected: true,
        keepsResultColor: true,
        style: { color: { r: 0.95, g: 0.5, b: 0.1, a: 1 } },
      },
    ]);
  });

  it.each([
    {
      name: "color",
      override: { color: { r: 0.1, g: 0.2, b: 0.3, a: 0.8 } },
      expectedColor: { r: 0.1, g: 0.2, b: 0.3, a: 0.8 },
      expectedOpacity: 1,
    },
    {
      name: "opacity",
      override: { opacity: 0.4 },
      expectedColor: { r: 0.95, g: 0.5, b: 0.1, a: 1 },
      expectedOpacity: 0.4,
    },
  ])(
    "disables result colors for selected body $name overrides",
    ({ override, expectedColor, expectedOpacity }) => {
      const { scene, runtime } = elementScene();
      let interaction = setBodySelected(
        createInteractionState(),
        { partOccurrenceId: "1/0", bodyId: 3 },
        true,
      );
      interaction = setBodyOverride(interaction, { partOccurrenceId: "1/0", bodyId: 3 }, override);
      const updates = collectEmphasisUpdates(
        runtime,
        buildInstanceLayout(runtime),
        new Map([["1/0", 0]]),
        { parts: partsMap(scene), interaction },
      );
      expect(updates.get(1)).toMatchObject([
        {
          selected: true,
          keepsResultColor: false,
          style: { color: expectedColor, opacity: expectedOpacity },
        },
      ]);
    },
  );

  it("maps selected edges through the rendered resource keys", () => {
    const { scene, runtime } = elementScene();
    const interaction = setEdgeSelected(
      createInteractionState(),
      { partOccurrenceId: "1/0", key: "0,2" },
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
    const scene = createSceneBuilder()
      .addPart(point)
      .addAssembly({
        id: 1,
        name: "standalone-node",
        placements: [{ kind: "part", partId: 2, transform: translationMatrix(0, 0, 0) }],
      })
      .setRootAssembly(1)
      .build();
    const runtime = createPackedSceneRuntime(scene);
    const layout = buildInstanceLayout(runtime);
    const interaction = setNodeSelected(
      createInteractionState(),
      { partOccurrenceId: "1/0", nodeId: 0 },
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
      { partOccurrenceId: "1/0", elementId: 0, faceIndex: 1 },
      true,
    );
    interaction = setNodeSelected(interaction, { partOccurrenceId: "1/1", nodeId: 2 }, true);
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
      { partOccurrenceId: "1/0", elementId: 0, faceIndex: 9 },
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
    interaction = setElementSelected(interaction, { partOccurrenceId: "1/0", elementId: 0 }, true);
    interaction = setElementOverride(
      interaction,
      { partOccurrenceId: "1/1", elementId: 0 },
      {
        emissive: 0.9,
      },
    );
    interaction = setTargetHovered(interaction, {
      kind: "element",
      partOccurrenceId: "1/0",
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
    interaction = setElementSelected(interaction, { partOccurrenceId: "1/0", elementId: 0 }, true);
    interaction = setElementSelected(
      interaction,
      { partOccurrenceId: "stale", elementId: 0 },
      true,
    );
    const updates = collectEmphasisUpdates(runtime, layout, slotByInstanceId, {
      parts: partsMap(scene),
      interaction,
    });
    expect((updates.get(1) ?? []).map((update) => update.slot)).toEqual([0]);
  });
});
