import { describe, expect, it } from "vitest";
import { createPart, type Part } from "../../../src/geometry/part";
import { identity } from "../../../src/math/mat4";
import { createInteractionState } from "../../../src/interaction/interaction";
import { setTargetsSelected } from "../../../src/interaction/targets";
import { createPackedSceneRuntime } from "../../../src/scene-runtime/runtime";
import { createScene } from "../../../src/scene/scene";
import { buildInstanceLayout, buildSelectionOrder } from "../../../src/renderer/runtime-state";
import { buildSelectionDrawCalls } from "../../../src/renderer/selection/draw-ranges";
import {
  collectDenseElementSelections,
  type DenseElementSelections,
} from "../../../src/renderer/selection/element-selection";
import { denseSelectionPart, interiorSubsetPart } from "../integration/runtime-state/support";

interface SelectionFixture {
  readonly runtime: ReturnType<typeof createPackedSceneRuntime>;
  readonly layout: ReturnType<typeof buildInstanceLayout>;
  readonly interaction: ReturnType<typeof createInteractionState>;
  readonly order: Uint32Array;
  readonly denseSelections: DenseElementSelections;
}

describe("dense selection skin ranges", () => {
  it("uses the selected owner's orientation for interface faces", () => {
    const fixture = selectionFixture(denseSelectionPart, [101, 103]);
    expect(buildCalls(denseSelectionPart, fixture)).toEqual([
      { partId: denseSelectionPart.id, instanceCount: 1, firstInstance: 0, surfaceSubset: true },
      {
        partId: denseSelectionPart.id,
        instanceCount: 1,
        firstInstance: 0,
        surfaceSubset: true,
        selectionRanges: [
          { primitive: "triangles", firstIndex: 3, indexCount: 3 },
          { primitive: "triangles", firstIndex: 12, indexCount: 3 },
        ],
      },
    ]);
  });

  it("falls back when a dense payload omits a selected bit", () => {
    const fixture = selectionFixture(denseSelectionPart, [101, 102]);
    const dense = fixture.denseSelections.get(denseSelectionPart.id);
    const occurrence = dense?.occurrences[0];
    if (dense === undefined || occurrence === undefined) throw new Error("Dense fixture missing");
    const denseSelections = new Map(fixture.denseSelections);
    denseSelections.set(denseSelectionPart.id, {
      ...dense,
      occurrences: [{ slot: occurrence.slot, selectedCount: 1, words: new Uint32Array([1]) }],
    });
    expect(buildCalls(denseSelectionPart, { ...fixture, denseSelections })).toBeUndefined();
  });

  it("falls back when selected element ids include an invalid id", () => {
    const fixture = selectionFixture(denseSelectionPart, [101, 102, 999]);
    expect(buildCalls(denseSelectionPart, fixture)).toBeUndefined();
  });

  it("falls back when a dense selection includes a non-triangle element", () => {
    const part = mixedPrimitivePart();
    const fixture = selectionFixture(part, [101, 102, 103]);
    expect(buildCalls(part, fixture)).toBeUndefined();
  });

  it("falls back when a face neighbor is outside the local element table", () => {
    const part = externalNeighborPart();
    const fixture = selectionFixture(part, [101, 102]);
    expect(buildCalls(part, fixture)).toBeUndefined();
  });

  it("uses the dense occurrence matching a nonzero local slot", () => {
    const fixture = selectionFixture(denseSelectionPart, [101, 102], {
      instanceId: "1/1",
      placementCount: 2,
    });
    expect(buildCalls(denseSelectionPart, fixture)).toEqual([
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

  it("resolves a retained local after placement shrink and reordering", () => {
    const first = placedScene(denseSelectionPart, ["a", "b", "c", "d"]);
    const firstRuntime = createPackedSceneRuntime(first);
    const firstLayout = buildInstanceLayout(firstRuntime);
    const second = placedScene(denseSelectionPart, ["d", "new", "b"]);
    const runtime = createPackedSceneRuntime(second);
    const layout = buildInstanceLayout(runtime, { runtime: firstRuntime, layout: firstLayout });
    const instanceId = runtime.getInstanceId(0);
    if (instanceId === undefined) throw new Error("Retained placement is missing");
    const interaction = setTargetsSelected(
      createInteractionState(),
      [101, 102].map((elementId) => ({
        kind: "element" as const,
        instanceId,
        elementId,
      })),
      true,
    );
    const parts = new Map([[denseSelectionPart.id, denseSelectionPart]]);
    const fixture = {
      runtime,
      layout,
      interaction,
      order: buildSelectionOrder(layout, runtime, denseSelectionPart.id, interaction, parts),
      denseSelections: collectDenseElementSelections(runtime, layout, parts, interaction),
    };

    expect(fixture.order).toEqual(new Uint32Array([3]));
    expect(buildCalls(denseSelectionPart, fixture)).toEqual([
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

  it("groups many dense occurrences by their local slots", () => {
    const elementIdsByInstance = Array.from({ length: 64 }, (_, index) =>
      index % 2 === 0 ? [101, 102] : [101, 103],
    );
    const fixture = selectionFixture(denseSelectionPart, [101, 102], {
      placementCount: 64,
      allPlacements: true,
      elementIdsByInstance,
    });
    const calls = buildCalls(denseSelectionPart, fixture);
    expect(calls).toHaveLength(128);
    expect(calls?.[1]?.selectionRanges).toEqual([
      { primitive: "triangles", firstIndex: 9, indexCount: 3 },
    ]);
    expect(calls?.[3]?.selectionRanges).toEqual([
      { primitive: "triangles", firstIndex: 3, indexCount: 3 },
      { primitive: "triangles", firstIndex: 12, indexCount: 3 },
    ]);
  });

  it("keeps the fallback for an interior face subset", () => {
    const fixture = selectionFixture(interiorSubsetPart, [101, 102, 103]);
    expect(buildCalls(interiorSubsetPart, fixture)).toBeUndefined();
  });
});

function selectionFixture(
  part: Part,
  elementIds: readonly number[],
  options: {
    readonly instanceId?: string;
    readonly placementCount?: number;
    readonly allPlacements?: boolean;
    readonly elementIdsByInstance?: readonly (readonly number[])[];
  } = {},
): SelectionFixture {
  const instanceId = options.instanceId ?? "1/0";
  const placementCount = options.placementCount ?? 1;
  const placements = Array.from({ length: placementCount }, () => ({
    kind: "part" as const,
    partId: part.id,
    transform: identity(),
  }));
  const scene = createScene()
    .addPart(part)
    .addAssembly({ id: 1, name: "root", placements })
    .withRoot(1)
    .build();
  const runtime = createPackedSceneRuntime(scene);
  const layout = buildInstanceLayout(runtime);
  const selectedInstances = options.allPlacements
    ? Array.from({ length: placementCount }, (_, index) => `1/${index}`)
    : [instanceId];
  const interaction = setTargetsSelected(
    createInteractionState(),
    selectedInstances.flatMap((selectedInstanceId, index) =>
      (options.elementIdsByInstance?.[index] ?? elementIds).map((elementId) => ({
        kind: "element" as const,
        instanceId: selectedInstanceId,
        elementId,
      })),
    ),
    true,
  );
  return {
    runtime,
    layout,
    interaction,
    order: buildSelectionOrder(layout, runtime, part.id, interaction, new Map([[part.id, part]])),
    denseSelections: collectDenseElementSelections(
      runtime,
      layout,
      new Map([[part.id, part]]),
      interaction,
    ),
  };
}

function buildCalls(part: Part, fixture: SelectionFixture) {
  return buildSelectionDrawCalls({
    layout: fixture.layout,
    runtime: fixture.runtime,
    partId: part.id,
    interaction: fixture.interaction,
    part,
    order: fixture.order,
    denseSelections: fixture.denseSelections,
  });
}

function placedScene(part: Part, placementIds: readonly string[]) {
  return createScene()
    .addPart(part)
    .addAssembly({
      id: 1,
      name: "root",
      placements: placementIds.map((placementId) => ({
        kind: "part" as const,
        placementId,
        partId: part.id,
        transform: identity(),
      })),
    })
    .withRoot(1)
    .build();
}

function mixedPrimitivePart(): Part {
  const triangles = denseSelectionPart.geometries.find(
    (geometry) => geometry.primitive === "triangles",
  );
  if (triangles?.primitive !== "triangles") throw new Error("Dense triangle fixture missing");
  return createPart(7, {
    geometries: [
      triangles,
      {
        primitive: "lines",
        positions: new Float32Array([0, 0, 0, 1, 0, 0]),
        indices: new Uint32Array([0, 1]),
      },
    ],
    elements: (denseSelectionPart.elements ?? []).map((element) =>
      element.id === 103
        ? {
            ...element,
            primitiveRanges: [
              ...element.primitiveRanges,
              { primitive: "lines" as const, primitiveStart: 0, primitiveCount: 1 },
            ],
          }
        : element,
    ),
  });
}

function externalNeighborPart(): Part {
  const triangles = denseSelectionPart.geometries.find(
    (geometry) => geometry.primitive === "triangles",
  );
  if (triangles?.primitive !== "triangles" || triangles.faces === undefined) {
    throw new Error("Dense triangle fixture missing");
  }
  const geometry = {
    ...triangles,
    faces: triangles.faces.map((face) =>
      face.elementId === 101 && face.faceIndex === 1 ? { ...face, neighborElementId: 999 } : face,
    ),
  };
  const elements = denseSelectionPart.elements;
  return elements === undefined
    ? createPart(8, { geometries: [geometry] })
    : createPart(8, { geometries: [geometry], elements });
}
