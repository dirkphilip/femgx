import { expect, it, describe } from "vitest";
import {
  createPart,
  createInteractionState,
  setElementSelected,
  setBodyOverride,
  setBodyVisible,
  setTargetHovered,
  translation,
  createPackedSceneRuntime,
  createScene,
  collectEmphasisUpdates,
  getPartSemanticIndex,
  collectDenseElementSelections,
  buildInstanceLayout,
  createBoltedPlateFixture,
  partFor,
  elementScene,
  partsMap,
  type ElementTessellation,
  type SemanticTestGeometry,
} from "./support";
import { denseSelectionContains } from "../../../../src/renderer/selection/element-selection";
import { setTargetsSelected } from "../../../../src/interaction/targets";

describe("collectEmphasisUpdates", () => {
  it("chooses dense membership only when it beats sparse selected records", () => {
    const { runtime, layout, parts } = denseSelectionFixture(1_000);
    let sparseInteraction = createInteractionState();
    sparseInteraction = setElementSelected(
      sparseInteraction,
      { instanceId: "1/0", elementId: 20_000 },
      true,
    );
    expect(
      collectDenseElementSelections(runtime, layout, parts, sparseInteraction).get(99),
    ).toBeUndefined();
    let denseInteraction = sparseInteraction;
    for (let index = 1; index < 50; index += 1) {
      denseInteraction = setElementSelected(
        denseInteraction,
        { instanceId: "1/0", elementId: 20_000 + index },
        true,
      );
    }
    const denseSelections = collectDenseElementSelections(runtime, layout, parts, denseInteraction);
    const dense = denseSelections.get(99);
    expect(dense?.occurrences[0]?.slot).toBe(0);
    expect(dense?.occurrences[0]?.words.length).toBe(32);
    expect(Array.from(dense?.occurrences[0]?.words.slice(0, 2) ?? [])).toEqual([
      0xffffffff, 0x3ffff,
    ]);
    const invalid = setElementSelected(
      denseInteraction,
      { instanceId: "1/0", elementId: 999_999 },
      true,
    );
    const invalidDense = collectDenseElementSelections(runtime, layout, parts, invalid).get(99);
    const invalidOccurrence = invalidDense?.occurrences[0];
    expect(invalidOccurrence?.words.length).toBe(32);
    expect(denseSelectionContains(invalidDense, 0, 1)).toBe(true);
    expect(denseSelectionContains(invalidDense, 0, 51)).toBe(false);

    const updates = collectEmphasisUpdates(runtime, layout, new Map([["1/0", 0]]), {
      parts,
      interaction: denseInteraction,
      denseSelections,
    });
    expect(updates.get(99)).toBeUndefined();
    const hovered = setTargetHovered(denseInteraction, {
      kind: "element",
      instanceId: "1/0",
      elementId: 20_000,
    });
    expect(collectDenseElementSelections(runtime, layout, parts, hovered)).toBe(denseSelections);
  });

  it("keeps equality at the dense cutoff sparse", () => {
    const { runtime, layout, parts, instanceId } = denseSelectionFixture(321);
    const interaction = setElementSelected(
      createInteractionState(),
      { instanceId, elementId: 20_000 },
      true,
    );

    expect(collectDenseElementSelections(runtime, layout, parts, interaction)).toEqual(new Map());
  });

  it("sorts reverse-ordered occurrences before dense packing", () => {
    const { runtime, layout, parts, instanceIds } = denseSelectionFixture(1_000, 2);
    const selectedIds = Array.from({ length: 50 }, (_, index) => 20_000 + index);
    const targets = instanceIds
      .slice()
      .reverse()
      .flatMap((instanceId) =>
        selectedIds.map((elementId) => ({ kind: "element" as const, instanceId, elementId })),
      );
    const dense = collectDenseElementSelections(
      runtime,
      layout,
      parts,
      setTargetsSelected(createInteractionState(), targets, true),
    ).get(99);

    expect(dense?.occurrences.map(({ slot }) => slot)).toEqual([0, 1]);
    expect(dense?.occurrences.map(({ words }) => Array.from(words.slice(0, 2)))).toEqual([
      [0xffffffff, 0x3ffff],
      [0xffffffff, 0x3ffff],
    ]);
  });

  it("caches sparse element, body, and face ownership by part identity", () => {
    const geometry: SemanticTestGeometry = {
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      indices: new Uint32Array([0, 1, 2]),
      primitive: "triangles",
      elements: [
        {
          id: 100_000,
          primitiveRanges: [{ primitive: "triangles", primitiveStart: 0, primitiveCount: 1 }],
          bodyId: 7,
        },
      ],
      bodies: [{ id: 7, elementIds: [100_000] }],
      faces: [
        {
          elementId: 100_000,
          faceIndex: 0,
          primitiveStart: 0,
          primitiveCount: 1,
          key: "sparse",
          nodeIds: [],
          bodyId: 7,
        },
      ],
    };
    const part = partFor(geometry);
    const metadata = getPartSemanticIndex(part);
    expect(getPartSemanticIndex(part)).toBe(metadata);
    expect(metadata.elements.get(100_000)).toBe(geometry.elements?.[0]);
    expect(metadata.bodies.get(7)).toBe(geometry.bodies?.[0]);
    expect(metadata.bodyByElement.get(100_000)).toBe(7);
    expect(metadata.faces.get("100000/0")?.faceId).toBe(0);

    const replacement = partFor({
      ...geometry,
      positions: new Float32Array(geometry.positions),
      indices: new Uint32Array(geometry.indices),
    });
    expect(getPartSemanticIndex(replacement)).not.toBe(metadata);
  });

  it("maps authored fixture bodies to reusable part-local records", () => {
    const fixture = createBoltedPlateFixture();
    const runtime = createPackedSceneRuntime(fixture.scene);
    const layout = buildInstanceLayout(runtime);
    const instanceId = runtime.getInstanceId(0);
    if (instanceId === undefined) throw new Error("expected the first fixture instance");
    let interaction = createInteractionState();
    interaction = setBodyVisible(interaction, { instanceId, bodyId: 2 }, false);
    const updates = collectEmphasisUpdates(runtime, layout, new Map([[instanceId, 0]]), {
      parts: new Map(fixture.scene.parts),
      interaction,
    });
    expect(updates.get(fixture.partIds.plate.partId)).toMatchObject([
      { slot: 0, bodyPickId: 3, hidden: true },
    ]);
  });

  it("maps body style and visibility to one reusable body record", () => {
    const { scene, runtime } = elementScene();
    const layout = buildInstanceLayout(runtime);
    const slotByInstanceId = new Map([["1/0", 0]]);
    let interaction = createInteractionState();
    interaction = setBodyOverride(interaction, { instanceId: "1/0", bodyId: 3 }, { emissive: 0.8 });
    interaction = setBodyVisible(interaction, { instanceId: "1/0", bodyId: 3 }, false);
    const updates = collectEmphasisUpdates(runtime, layout, slotByInstanceId, {
      parts: partsMap(scene),
      interaction,
    });
    expect(updates.get(1)).toMatchObject([
      { slot: 0, bodyPickId: 4, hidden: true, style: { emissive: 0.8 } },
    ]);
  });

  it("maps emphasized element occurrences to per-part records", () => {
    const { scene, runtime } = elementScene();
    const layout = buildInstanceLayout(runtime);
    const slotByInstanceId = new Map([
      ["1/0", 0],
      ["1/1", 1],
    ]);
    let interaction = createInteractionState();
    interaction = setElementSelected(interaction, { instanceId: "1/1", elementId: 0 }, true);
    const updates = collectEmphasisUpdates(runtime, layout, slotByInstanceId, {
      parts: partsMap(scene),
      interaction,
    });
    expect(Array.from(updates.keys())).toEqual([1]);
    const list = updates.get(1) ?? [];
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ slot: 1, elementPickId: 1, selected: true });
  });
});

function denseSelectionFixture(elementCount: number, placementCount = 1) {
  const elements: ElementTessellation[] = Array.from({ length: elementCount }, (_, index) => ({
    id: 20_000 + index,
    primitiveRanges: [{ primitive: "triangles", primitiveStart: index, primitiveCount: 1 }],
  }));
  const part = createPart(99, {
    geometries: [
      {
        positions: new Float32Array(elementCount * 9),
        indices: Uint32Array.from({ length: elementCount * 3 }, (_, index) => index % 3),
        primitive: "triangles",
      },
    ],
    elements,
  });
  const scene = createScene()
    .addPart(part)
    .addAssembly({
      id: 1,
      name: "dense-selection",
      placements: Array.from({ length: placementCount }, (_, index) => ({
        kind: "part" as const,
        partId: 99,
        transform: translation(index, 0, 0),
      })),
    })
    .withRoot(1)
    .build();
  const runtime = createPackedSceneRuntime(scene);
  const instanceIds = Array.from({ length: placementCount }, (_, index) => {
    const instanceId = runtime.getInstanceId(index);
    if (instanceId === undefined) throw new Error(`Missing dense fixture instance ${index}`);
    return instanceId;
  });
  return {
    instanceId: instanceIds[0] ?? "",
    instanceIds,
    layout: buildInstanceLayout(runtime),
    parts: new Map(scene.parts),
    runtime,
  };
}
