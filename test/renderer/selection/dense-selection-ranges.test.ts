import { describe, expect, it } from "vitest";
import { createPart, type Part } from "@/geometry/part";
import { identityMatrix } from "@/math/mat4";
import { createInteractionState } from "@/interaction/interaction";
import { setTargetsSelected } from "@/interaction/targets";
import { createPackedSceneRuntime } from "@/scene-runtime/runtime";
import { createSceneBuilder } from "@/scene/scene";
import { buildInstanceLayout, buildSelectionOrder } from "@/renderer/runtime-state";
import { buildSelectionDrawCalls } from "@/renderer/selection/draw-ranges";
import {
  collectDenseElementSelections,
  type DenseElementSelections,
} from "@/renderer/selection/element-selection";
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

  it("rebuilds exact ranges when a dense payload omits a selected bit", () => {
    const fixture = selectionFixture(denseSelectionPart, [101, 102]);
    const dense = fixture.denseSelections.get(denseSelectionPart.id);
    const occurrence = dense?.occurrences[0];
    if (dense === undefined || occurrence === undefined) throw new Error("Dense fixture missing");
    const denseSelections = new Map(fixture.denseSelections);
    denseSelections.set(denseSelectionPart.id, {
      ...dense,
      occurrences: [{ slot: occurrence.slot, selectedCount: 1, words: new Uint32Array([1]) }],
    });
    expect(buildCalls(denseSelectionPart, { ...fixture, denseSelections })).toEqual([
      {
        partId: denseSelectionPart.id,
        instanceCount: 1,
        firstInstance: 0,
        selectionRanges: [{ primitive: "triangles", firstIndex: 0, indexCount: 12 }],
      },
    ]);
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
      partOccurrenceId: "1/1",
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
    const partOccurrenceId = runtime.getInstanceId(0);
    if (partOccurrenceId === undefined) throw new Error("Retained placement is missing");
    const interaction = setTargetsSelected(
      createInteractionState(),
      [101, 102].map((elementId) => ({
        kind: "element" as const,
        partOccurrenceId,
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

  it("retains exact full-element ranges for an interior face subset", () => {
    const fixture = selectionFixture(interiorSubsetPart, [101, 102, 103]);
    expect(buildCalls(interiorSubsetPart, fixture)).toEqual([
      {
        partId: interiorSubsetPart.id,
        instanceCount: 1,
        firstInstance: 0,
        selectionRanges: [{ primitive: "triangles", firstIndex: 0, indexCount: 18 }],
      },
    ]);
  });

  it("uses the ordinary surface pass when dense selection covers complete geometry", () => {
    const part = completeExplicitTopologyPart();
    const fixture = selectionFixture(part, [101, 102, 103]);
    expect(buildCalls(part, fixture)).toEqual([]);
  });

  it("retains more than 1024 fragmented subset ranges for one compact replay", () => {
    const part = fragmentedSubsetPart(4_099);
    const selected = Array.from({ length: 1_025 }, (_, index) => index * 2 + 1);
    const fixture = selectionFixture(part, selected);
    const calls = buildCalls(part, fixture);
    expect(calls).toHaveLength(1);
    expect(calls?.[0]?.selectionRanges).toHaveLength(1_025);
    expect(calls?.[0]?.selectionRanges?.[0]).toEqual({
      primitive: "triangles",
      firstIndex: 0,
      indexCount: 3,
    });
    expect(calls?.[0]?.selectionRanges?.at(-1)).toEqual({
      primitive: "triangles",
      firstIndex: 6_144,
      indexCount: 3,
    });
  });
});

function selectionFixture(
  part: Part,
  elementIds: readonly number[],
  options: {
    readonly partOccurrenceId?: string;
    readonly placementCount?: number;
    readonly allPlacements?: boolean;
    readonly elementIdsByInstance?: readonly (readonly number[])[];
  } = {},
): SelectionFixture {
  const partOccurrenceId = options.partOccurrenceId ?? "1/0";
  const placementCount = options.placementCount ?? 1;
  const placements = Array.from({ length: placementCount }, () => ({
    kind: "part" as const,
    partId: part.id,
    transform: identityMatrix(),
  }));
  const scene = createSceneBuilder()
    .addPart(part)
    .addAssembly({ id: 1, name: "root", placements })
    .setRootAssembly(1)
    .build();
  const runtime = createPackedSceneRuntime(scene);
  const layout = buildInstanceLayout(runtime);
  const selectedInstances = options.allPlacements
    ? Array.from({ length: placementCount }, (_, index) => `1/${index}`)
    : [partOccurrenceId];
  const interaction = setTargetsSelected(
    createInteractionState(),
    selectedInstances.flatMap((selectedInstanceId, index) =>
      (options.elementIdsByInstance?.[index] ?? elementIds).map((elementId) => ({
        kind: "element" as const,
        partOccurrenceId: selectedInstanceId,
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
  return createSceneBuilder()
    .addPart(part)
    .addAssembly({
      id: 1,
      name: "root",
      placements: placementIds.map((placementId) => ({
        kind: "part" as const,
        placementId,
        partId: part.id,
        transform: identityMatrix(),
      })),
    })
    .setRootAssembly(1)
    .build();
}

function mixedPrimitivePart(): Part {
  const triangles = denseSelectionPart.geometries.find(
    (geometry) => geometry.primitive === "triangles",
  );
  if (triangles?.primitive !== "triangles") throw new Error("Dense triangle fixture missing");
  const { edges: _edges, faces: _faces, faceSubset: _faceSubset, ...triangleInput } = triangles;
  return createPart(7, {
    geometries: [
      triangleInput,
      {
        primitive: "lines",
        positions: new Float32Array([0, 0, 0, 1, 0, 0]),
        indices: new Uint32Array([0, 1]),
      },
    ],
    elements: [...(denseSelectionPart.elements ?? [])].map((element) =>
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

function completeExplicitTopologyPart(): Part {
  const geometry = denseSelectionPart.geometries.find(
    (candidate) => candidate.primitive === "triangles",
  );
  if (geometry?.primitive !== "triangles") throw new Error("Dense triangle fixture missing");
  const { edges: _edges, faces: _faces, faceSubset: _faceSubset, ...completeGeometry } = geometry;
  return createPart(8, {
    geometries: [completeGeometry],
    elements: [...(denseSelectionPart.elements ?? [])],
  });
}

function fragmentedSubsetPart(elementCount: number): Part {
  const indices = new Uint32Array(elementCount * 3);
  const faces = [];
  const elements = [];
  const faceIds = [];
  for (let ordinal = 0; ordinal < elementCount; ordinal += 1) {
    indices.set([0, 1, 2], ordinal * 3);
    const elementId = ordinal + 1;
    const node = ordinal * 3;
    faces.push({
      elementId,
      faceIndex: 0,
      primitiveStart: ordinal,
      primitiveCount: 1,
      key: `${node},${node + 1},${node + 2}`,
      nodeIds: [node, node + 1, node + 2],
    });
    elements.push({
      id: elementId,
      primitiveRanges: [
        { primitive: "triangles" as const, primitiveStart: ordinal, primitiveCount: 1 },
      ],
    });
    faceIds.push({ elementId, faceIndex: 0 });
  }
  return createPart(9, {
    geometries: [
      {
        primitive: "triangles",
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        indices,
        faces,
        faceSubset: { faceIds },
      },
    ],
    elements,
  });
}

function externalNeighborPart(): Part {
  const triangles = denseSelectionPart.geometries.find(
    (geometry) => geometry.primitive === "triangles",
  );
  if (triangles?.primitive !== "triangles" || triangles.faces === undefined) {
    throw new Error("Dense triangle fixture missing");
  }
  const { edges: _edges, faces: _faces, faceSubset: _faceSubset, ...triangleInput } = triangles;
  const geometry = {
    ...triangleInput,
    faces: Array.from(triangles.faces, (face) =>
      face.elementId === 101 && face.faceIndex === 1 ? { ...face, neighborElementId: 999 } : face,
    ),
  };
  const elements = denseSelectionPart.elements;
  return elements === undefined
    ? createPart(8, { geometries: [geometry] })
    : createPart(8, { geometries: [geometry], elements: [...elements] });
}
