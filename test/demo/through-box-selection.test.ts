import {
  createCamera,
  createInteractionState,
  createPart,
  createSceneRuntime,
  identity,
  setElementBlockVisible,
  setElementVisible,
  type FemViewport,
  type ElementTessellation,
  type Geometry,
  type InteractionState,
  type Scene,
} from "../../src/index";
import type { BoxSelectionRequest } from "../../demo/workbench/selection/box-selection-resolver";
import { throughIntersectionBoxSelectionResolver } from "../../demo/workbench/selection/through-box-selection";
import { createPlanarGridGeometry } from "../../demo/fixture/planar-grid";
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

    await expect(resolver(request("element"))).resolves.toEqual([
      { kind: "element", instanceId: runtime.getVisibleInstanceIds()[0], elementId: 1 },
      { kind: "element", instanceId: runtime.getVisibleInstanceIds()[0], elementId: 3 },
      { kind: "element", instanceId: runtime.getVisibleInstanceIds()[0], elementId: 4 },
    ]);
  });

  it("applies hidden element state before testing authored primitive ranges", async () => {
    const { scene, runtime } = fixture();
    const instanceId = runtime.getVisibleInstanceIds()[0];
    const interaction = setElementVisible(
      createInteractionState(),
      { instanceId: instanceId as string, elementId: 1 },
      false,
    );
    const resolver = throughIntersectionBoxSelectionResolver(() =>
      viewport(scene, runtime, interaction),
    );

    await expect(resolver(request("element"))).resolves.toEqual([
      { kind: "element", instanceId, elementId: 3 },
      { kind: "element", instanceId, elementId: 4 },
    ]);
  });

  it("respects block membership declared outside element records", async () => {
    const { scene, runtime } = fixture(true);
    const instanceId = runtime.getVisibleInstanceIds()[0] as string;
    const interaction = setElementBlockVisible(
      createInteractionState(),
      { instanceId, blockId: 1 },
      false,
    );
    const resolver = throughIntersectionBoxSelectionResolver(() =>
      viewport(scene, runtime, interaction),
    );

    await expect(resolver(request("element"))).resolves.toEqual([
      { kind: "element", instanceId, elementId: 1 },
      { kind: "element", instanceId, elementId: 4 },
    ]);
  });

  it("uses displayed positive section-plane geometry while retaining crossing segments", async () => {
    const { scene, runtime, interaction } = fixture();
    const resolver = throughIntersectionBoxSelectionResolver(() =>
      viewport(scene, runtime, interaction, { normal: [1, 0, 0], distance: -1 }),
    );

    await expect(resolver(request("element"))).resolves.toEqual([
      { kind: "element", instanceId: runtime.getVisibleInstanceIds()[0], elementId: 4 },
    ]);
  });

  it("selects an element intersected only by a triangle omitted from ordinary rendering", async () => {
    const part = omittedTrianglePart();
    const scene = sceneFor(part);
    const runtime = createSceneRuntime(scene);
    const resolver = throughIntersectionBoxSelectionResolver(() =>
      viewport(scene, runtime, createInteractionState()),
    );

    await expect(resolver(request("element"))).resolves.toEqual([
      {
        kind: "element",
        instanceId: runtime.getVisibleInstanceIds()[0],
        elementId: 2,
      },
    ]);
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
    const runtime = createSceneRuntime(scene);
    const resolver = throughIntersectionBoxSelectionResolver(() =>
      viewport(scene, runtime, createInteractionState()),
    );

    await expect(resolver(request("element"))).resolves.toHaveLength(250_632);
  });
});

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
  runtime: ReturnType<typeof createSceneRuntime>,
  interaction: InteractionState,
  sectionPlane?: { readonly normal: readonly [number, number, number]; readonly distance: number },
): FemViewport {
  return {
    scene,
    runtime,
    interaction,
    camera: createCamera({
      mode: "orthographic",
      position: [0, 0, 10],
      target: [0, 0, 0],
      up: [0, 1, 0],
      width: 100,
      height: 100,
      orthoHeight: 10,
    }),
    results: {
      config: {},
      scalar: undefined,
      deformation: {
        scale: 1,
        displacements: new Map([[1, new Float32Array([-2, -2, 0, 0, 0, 0])]]),
      },
      vectors: undefined,
    },
    sectionPlane,
  } as unknown as FemViewport;
}

function fixture(derivedVisibility = false): {
  readonly scene: Scene;
  readonly runtime: ReturnType<typeof createSceneRuntime>;
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
    ...(derivedVisibility ? { blocks: [{ id: 1, elementIds: [3] }] } : {}),
  });
  const scene = sceneFor(part);
  return { scene, runtime: createSceneRuntime(scene), interaction: createInteractionState() };
}

function sceneFor(part: ReturnType<typeof createPart>): Scene {
  const scene: Scene = {
    rootAssemblyId: 0,
    parts: new Map([[part.id, part]]),
    assemblies: new Map([
      [
        0,
        {
          id: 0,
          name: "root",
          placements: [
            { kind: "part", placementId: "part", partId: part.id, transform: identity() },
          ],
        },
      ],
    ]),
    visiblePartIds: new Set([part.id]),
    visibleAssemblyIds: new Set([0]),
  };
  return scene;
}

function triangleGeometry(): GeometryBuild<Geometry> {
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
            neighborElementIds: [],
          },
          {
            elementId: 2,
            faceIndex: 0,
            primitiveStart: 1,
            primitiveCount: 1,
            key: "3:4:5",
            nodeIds: [3, 4, 5],
            neighborElementIds: [],
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

function lineGeometry(): GeometryBuild<Geometry> {
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

interface GeometryBuild<T extends Geometry> {
  readonly geometry: T;
  readonly elements: readonly ElementTessellation[];
  readonly nodePositions: Float32Array;
}

function pointGeometry(): GeometryBuild<Geometry> {
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
