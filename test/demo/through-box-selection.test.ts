import {
  createPart,
  identityMatrix,
  translationMatrix,
  type Part,
  type Viewport,
  type ElementTessellation,
  type GeometryInput,
  type Scene,
  type ElementRef,
} from "../../src/entries/root";
import {
  createInteractionState,
  type ElementRegionSelection,
  type InteractionState,
} from "../../src/entries/interaction";
import { setBodyVisible } from "../../src/interaction/bodies";
import { setElementVisible } from "../../src/interaction/elements";
import { isBodyVisible } from "../../src/interaction/bodies";
import { isElementVisible } from "../../src/interaction/elements";
import { createCamera } from "../../src/entries/camera";
import { createSceneOccurrenceSnapshot } from "../../src/scene-runtime/occurrences";
import type { BoxSelectionRequest } from "../../demo/workbench/selection/box-selection-resolver";
import { throughIntersectionBoxSelectionResolver } from "../../demo/workbench/selection/through-box-selection";
import { createPlanarGridGeometry } from "../../demo/fixtures/planar-grid";
import { describe, expect, it } from "vitest";

const selectionRect = {
  left: 40,
  top: 40,
  right: 60,
  bottom: 60,
  width: 20,
  height: 20,
};

describe("through box selection", () => {
  it("returns mixed triangle, line, and deformed point element occurrences in stable order", async () => {
    const { scene, runtime, interaction } = fixture();
    const resolver = throughIntersectionBoxSelectionResolver(() =>
      viewport(scene, runtime, interaction),
    );

    await expectElementIds(resolver, [1, 3, 4]);
  });

  it("applies hidden element state before testing authored primitive ranges", async () => {
    const { scene, runtime } = fixture();
    const partOccurrenceId = runtime.getPartOccurrenceId(0);
    const interaction = setElementVisible(
      createInteractionState(),
      { partOccurrenceId: partOccurrenceId as string, elementId: 1 },
      false,
    );
    const resolver = throughIntersectionBoxSelectionResolver(() =>
      viewport(scene, runtime, interaction),
    );

    await expectElementIds(resolver, [3, 4], partOccurrenceId);
  });

  it("applies hidden body state when custom elements omit body ids", async () => {
    const part = bodyPart();
    const scene = sceneFor(part);
    const runtime = createSceneOccurrenceSnapshot(scene);
    const partOccurrenceId = runtime.getPartOccurrenceId(0);
    if (partOccurrenceId === undefined) throw new Error("Body fixture occurrence is missing");
    const interaction = setBodyVisible(
      createInteractionState(),
      { partOccurrenceId, bodyId: 10 },
      false,
    );
    const resolver = throughIntersectionBoxSelectionResolver(() =>
      viewport(scene, runtime, interaction),
    );

    await expectElementIds(resolver, [2], partOccurrenceId);
  });

  it("applies occurrence transforms before frustum intersection", async () => {
    const { part, interaction } = fixture();
    const scene = sceneFor(part, translationMatrix(10, 0, 0));
    const runtime = createSceneOccurrenceSnapshot(scene);
    const resolver = throughIntersectionBoxSelectionResolver(() =>
      viewport(scene, runtime, interaction, undefined, 10),
    );

    await expectElementIds(resolver, [1, 3, 4]);
  });

  it("uses displayed positive section-plane geometry while retaining crossing segments", async () => {
    const { scene, runtime, interaction } = fixture();
    const resolver = throughIntersectionBoxSelectionResolver(() =>
      viewport(scene, runtime, interaction, { normal: [1, 0, 0], distance: -1 }),
    );

    await expectElementIds(resolver, [4]);
  });

  it("selects an element intersected only by a triangle omitted from ordinary rendering", async () => {
    const part = omittedTrianglePart();
    const scene = sceneFor(part);
    const runtime = createSceneOccurrenceSnapshot(scene);
    const resolver = throughIntersectionBoxSelectionResolver(() =>
      viewport(scene, runtime, createInteractionState()),
    );

    await expectElementIds(resolver, [2]);
  });

  it("rejects through selection at a non-element granularity", () => {
    const { scene, runtime, interaction } = fixture();
    const resolver = throughIntersectionBoxSelectionResolver(() =>
      viewport(scene, runtime, interaction),
    );

    expect(() => resolver(request("face"))).toThrow(
      "Through box selection requires element granularity",
    );
  });

  it("returns every intersecting element in the 250k triangle example", async () => {
    const grid = createPlanarGridGeometry(354, { elementFamily: "triangle" });
    const part = createPart(1, {
      geometries: [grid.geometry],
      elements: grid.elements,
      nodePositions: grid.nodePositions,
    });
    const scene = sceneFor(part);
    const runtime = createSceneOccurrenceSnapshot(scene);
    const resolver = throughIntersectionBoxSelectionResolver(() =>
      viewport(scene, runtime, createInteractionState()),
    );

    expect(((await resolver(request("element"))) as ElementRegionSelection).count).toBe(250_632);
  });
});

async function expectElementIds(
  resolver: ReturnType<typeof throughIntersectionBoxSelectionResolver>,
  ids: readonly number[],
  occurrenceId?: string,
): Promise<void> {
  const selection = await resolver(request("element"));
  if (Array.isArray(selection)) throw new Error("Through resolver returned descriptors");
  const packed = selection as ElementRegionSelection;
  expect(packed.count).toBe(ids.length);
  expect([...packed.elementIds]).toEqual(ids);
  if (occurrenceId !== undefined) expect(packed.partOccurrenceIds).toEqual([occurrenceId]);
}

function request(granularity: "element" | "face"): BoxSelectionRequest {
  return {
    event: {
      type: "complete",
      anchor: { x: 40, y: 40 },
      current: { x: 60, y: 60 },
      rect: selectionRect,
      modifiers: { shift: false, control: false, alt: false, meta: false },
    },
    granularity,
  };
}

function viewport(
  scene: Scene,
  runtime: ReturnType<typeof createSceneOccurrenceSnapshot>,
  interaction: InteractionState,
  sectionPlane?: { readonly normal: readonly [number, number, number]; readonly distance: number },
  targetX = 0,
): Viewport {
  return {
    scene,
    occurrences: runtime,
    view: {
      camera: createCamera({
        mode: "orthographic",
        position: [targetX, 0, 10],
        target: [targetX, 0, 0],
        up: [0, 1, 0],
        width: 100,
        height: 100,
        orthoHeight: 10,
      }),
    },
    interaction: { state: interaction },
    visibility: {
      isElementEffectivelyVisible: ({ partOccurrenceId, elementId }: ElementRef) => {
        if (!isElementVisible(interaction, { partOccurrenceId, elementId })) return false;
        const part = scene.parts.get(runtime.getPartId(partOccurrenceId) ?? -1);
        const bodyId = part?.elements?.get(elementId)?.bodyId;
        return bodyId === undefined || isBodyVisible(interaction, { partOccurrenceId, bodyId });
      },
    },
    results: {
      state: {
        config: {},
        scalar: undefined,
        deformation: {
          scale: 1,
          displacements: new Map([[1, new Float32Array([-2, -2, 0, 0, 0, 0])]]),
        },
        orientation: undefined,
      },
    },
    presentation: { sectionPlane },
  } as unknown as Viewport;
}

function fixture(): {
  readonly part: ReturnType<typeof createPart>;
  readonly scene: Scene;
  readonly runtime: ReturnType<typeof createSceneOccurrenceSnapshot>;
  readonly interaction: InteractionState;
} {
  const triangle = triangleGeometry();
  const line = lineGeometry();
  const point = pointGeometry();
  const elements = [...triangle.elements, ...line.elements, ...point.elements].reduce(
    (merged, element) => {
      const previous = merged.get(element.id);
      merged.set(
        element.id,
        previous === undefined
          ? element
          : {
              ...previous,
              primitiveRanges: [...previous.primitiveRanges, ...element.primitiveRanges],
            },
      );
      return merged;
    },
    new Map<number, ElementTessellation>(),
  );
  const part = createPart(1, {
    geometries: [triangle.geometry, line.geometry, point.geometry],
    elements: [...elements.values()],
    nodePositions: point.nodePositions,
  });
  const scene = sceneFor(part);
  return {
    part,
    scene,
    runtime: createSceneOccurrenceSnapshot(scene),
    interaction: createInteractionState(),
  };
}

function sceneFor(part: ReturnType<typeof createPart>, transform = identityMatrix()): Scene {
  const scene: Scene = {
    rootAssemblyId: 0,
    parts: new Map([[part.id, part]]),
    assemblies: new Map([
      [
        0,
        {
          id: 0,
          name: "root",
          placements: [{ kind: "part", placementId: "part", partId: part.id, transform }],
        },
      ],
    ]),
    visiblePartIds: new Set([part.id]),
    visibleAssemblyIds: new Set([0]),
  };
  return scene;
}

function triangleGeometry(): GeometryBuild<GeometryInput> {
  return {
    geometry: {
      primitive: "triangles",
      positions: new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0, 0.5, 0]),
      indices: new Uint32Array([0, 1, 2]),
    },
    elements: [
      {
        id: 1,
        primitiveRanges: [{ primitive: "triangles", primitiveStart: 0, primitiveCount: 1 }],
      },
    ],
    nodePositions: new Float32Array(),
  };
}

function omittedTrianglePart(): ReturnType<typeof createPart> {
  return createPart(1, {
    geometries: [
      {
        primitive: "triangles",
        positions: new Float32Array([3, 0, 0, 4, 0, 0, 3, 1, 0, 0, 0, 0, 0.5, 0, 0, 0, 0.5, 0]),
        indices: new Uint32Array([0, 1, 2, 3, 4, 5]),
        faces: [
          {
            elementId: 1,
            faceIndex: 0,
            primitiveStart: 0,
            primitiveCount: 1,
            key: "0:1:2",
            nodeIds: [0, 1, 2],
          },
          {
            elementId: 2,
            faceIndex: 0,
            primitiveStart: 1,
            primitiveCount: 1,
            key: "3:4:5",
            nodeIds: [3, 4, 5],
          },
        ],
        faceSubset: { faceIds: [{ elementId: 1, faceIndex: 0 }] },
      },
    ],
    elements: [
      {
        id: 1,
        primitiveRanges: [{ primitive: "triangles", primitiveStart: 0, primitiveCount: 1 }],
      },
      {
        id: 2,
        primitiveRanges: [{ primitive: "triangles", primitiveStart: 1, primitiveCount: 1 }],
      },
    ],
  });
}

function bodyPart(): Part {
  const part = createPart(1, {
    geometries: [
      {
        primitive: "triangles",
        positions: new Float32Array([
          -0.5, -0.5, 0, 0.5, -0.5, 0, 0, 0.5, 0, -0.5, -0.5, 0, 0.5, -0.5, 0, 0, 0.5, 0,
        ]),
        indices: new Uint32Array([0, 1, 2, 3, 4, 5]),
      },
    ],
    elements: [
      {
        id: 1,
        primitiveRanges: [{ primitive: "triangles", primitiveStart: 0, primitiveCount: 1 }],
      },
      {
        id: 2,
        primitiveRanges: [{ primitive: "triangles", primitiveStart: 1, primitiveCount: 1 }],
      },
    ],
  });
  return createPart(1, {
    geometries: [
      (() => {
        const geometry = part.geometries[0];
        if (geometry?.primitive !== "triangles") throw new Error("Expected triangle geometry");
        const { edges: _edges, faces: _faces, faceSubset: _faceSubset, ...input } = geometry;
        return input;
      })(),
    ],
    elements: [
      {
        id: 1,
        bodyId: 10,
        primitiveRanges: [{ primitive: "triangles", primitiveStart: 0, primitiveCount: 1 }],
      },
      {
        id: 2,
        bodyId: 20,
        primitiveRanges: [{ primitive: "triangles", primitiveStart: 1, primitiveCount: 1 }],
      },
    ],
    bodies: [
      { id: 10, elementIds: [1] },
      { id: 20, elementIds: [2] },
    ],
  });
}

function lineGeometry(): GeometryBuild<GeometryInput> {
  return {
    geometry: {
      primitive: "lines",
      positions: new Float32Array([-2, 0, 0, 2, 0, 0, 3, 0, 0, 4, 0, 0]),
      indices: new Uint32Array([0, 1, 2, 3]),
    },
    elements: [
      { id: 4, primitiveRanges: [{ primitive: "lines", primitiveStart: 0, primitiveCount: 1 }] },
      { id: 2, primitiveRanges: [{ primitive: "lines", primitiveStart: 1, primitiveCount: 1 }] },
    ],
    nodePositions: new Float32Array(),
  };
}

interface GeometryBuild<T extends GeometryInput> {
  readonly geometry: T;
  readonly elements: readonly ElementTessellation[];
  readonly nodePositions: Float32Array;
}

function pointGeometry(): GeometryBuild<GeometryInput> {
  return {
    geometry: {
      primitive: "points",
      positions: new Float32Array([0.25, 0.25, 0, 2, 2, 0]),
      indices: new Uint32Array([0, 1]),
      nodePickIds: new Uint32Array([2, 1]),
    },
    elements: [
      { id: 1, primitiveRanges: [{ primitive: "points", primitiveStart: 0, primitiveCount: 1 }] },
      { id: 3, primitiveRanges: [{ primitive: "points", primitiveStart: 1, primitiveCount: 1 }] },
    ],
    nodePositions: new Float32Array([0, 0, 0, 2, 2, 0]),
  };
}
