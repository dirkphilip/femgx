import { describe, expect, it } from "vitest";
import { createElement } from "../../src/elements/element";
import { createElementModel, type ElementModel } from "../../src/elements/model";
import { LINE_SHAPE, POINT_SHAPE, TET4_SHAPE } from "../../src/elements/shapes";
import { elementPart } from "../../src/geometry/heterogeneous-element-mesh";
import {
  createPart,
  validatePickIds,
  type Geometry,
  type Part,
  type TriangleGeometry,
} from "../../src/geometry/part";
import { identity, type Mat4 } from "../../src/math/mat4";
import {
  geometryAdjacency,
  resolveEdgePickHit,
  resolvePick,
  resolvePickHit,
  type PickContext,
  type ResolvedPickIds,
} from "../../src/picking/pick";
import type { Instance } from "../../src/scene/types";
import type { PickHit } from "../../src/picking/types";
import { interactionTargetFromHit } from "../../src/interaction/targets";

const TET_NODES: readonly number[] = [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1];

function tetModel(): ElementModel {
  return createElementModel(TET_NODES, [createElement(1, TET4_SHAPE, [0, 1, 2, 3])]);
}

function partWithGeometry(geometry: Geometry): Part {
  const elementId =
    (geometry.primitive === "triangles" ? geometry.faces?.[0]?.elementId : undefined) ??
    geometry.edges?.[0]?.incidentElementIds[0];
  return createPart(1, {
    geometries: [geometry],
    ...(elementId === undefined
      ? {}
      : {
          elements: [
            {
              id: elementId,
              primitiveRanges: [
                {
                  primitive: geometry.primitive,
                  primitiveStart: 0,
                  primitiveCount:
                    geometry.primitive === "triangles"
                      ? geometry.indices.length / 3
                      : geometry.primitive === "lines"
                        ? geometry.indices.length / 2
                        : geometry.indices.length,
                },
              ],
            },
          ],
          nodePositions: new Float32Array(TET_NODES),
        }),
  });
}

function instanceAt(index: number, partId = 1, transform: Mat4 = identity()): Instance {
  return { index, instanceId: `1/${index}`, partId, worldTransform: transform };
}

function ids(partial: Partial<ResolvedPickIds>): ResolvedPickIds {
  return { instancePickId: 0, elementPickId: 0, facePickId: 0, nodePickId: 0, ...partial };
}

function triangleGeometry(model: ElementModel): TriangleGeometry {
  const part = elementPart(1, model);
  if (part.geometries[0]?.primitive !== "triangles") throw new Error("expected triangle geometry");
  return part.geometries[0];
}

describe("resolvePick", () => {
  it("resolves a valid pick id to an instance", () => {
    expect(resolvePick([instanceAt(0), instanceAt(1, 2)], 1)?.partId).toBe(2);
  });

  it("returns undefined for out-of-range pick ids", () => {
    expect(resolvePick([instanceAt(0)], -1)).toBeUndefined();
    expect(resolvePick([instanceAt(0)], 99)).toBeUndefined();
  });
});

describe("resolvePickHit", () => {
  const geometry = triangleGeometry(tetModel());
  const part = partWithGeometry(geometry);
  const context: PickContext = { instances: [instanceAt(0)], parts: new Map([[1, part]]) };

  it("resolves an instance-only hit to an instance target", () => {
    expect(resolvePickHit(context, ids({ instancePickId: 1 }), [0, 0, 0])).toEqual({
      kind: "instance",
      partId: 1,
      instanceId: "1/0",
      worldPosition: [0, 0, 0],
    });
  });

  it("resolves an element hit to an element target", () => {
    expect(
      resolvePickHit(context, ids({ instancePickId: 1, elementPickId: 2 }), [0, 0, 0]),
    ).toEqual({
      kind: "element",
      partId: 1,
      instanceId: "1/0",
      elementId: 1,
      worldPosition: [0, 0, 0],
    });
  });

  it("preserves body identity on element, face, and node targets", () => {
    const bodyGeometry: TriangleGeometry = {
      ...geometry,
      faces: (geometry.faces ?? []).map((face) => ({ ...face, bodyId: 6 })),
    };
    const bodyPart = createPart(1, {
      geometries: [bodyGeometry],
      elements: (part.elements ?? []).map((element) => ({ ...element, bodyId: 6 })),
      bodies: [{ id: 6, elementIds: [1] }],
      nodePositions: new Float32Array(TET_NODES),
    });
    const bodyContext: PickContext = {
      instances: [instanceAt(0)],
      parts: new Map([[1, bodyPart]]),
    };
    expect(
      resolvePickHit(bodyContext, ids({ instancePickId: 1, elementPickId: 2 }), [0, 0, 0]),
    ).toMatchObject({ kind: "element", bodyId: 6 });
    expect(
      resolvePickHit(
        bodyContext,
        ids({ instancePickId: 1, elementPickId: 2, facePickId: 2 }),
        [0, 0, 0],
      ),
    ).toMatchObject({ kind: "face", bodyId: 6 });
    expect(
      resolvePickHit(
        bodyContext,
        ids({ instancePickId: 1, elementPickId: 2, facePickId: 3, nodePickId: 2 }),
        [0, 0, 0],
      ),
    ).toMatchObject({ kind: "node", bodyId: 6 });
  });

  it("returns undefined when the instance pick id misses", () => {
    expect(
      resolvePickHit(context, ids({ instancePickId: 0, elementPickId: 3 }), [0, 0, 0]),
    ).toBeUndefined();
    expect(
      resolvePickHit(context, ids({ instancePickId: 99, elementPickId: 3 }), [0, 0, 0]),
    ).toBeUndefined();
  });

  it("resolves a face hit to a face target with ordered vertices and normal", () => {
    const target = resolvePickHit(
      context,
      ids({ instancePickId: 1, elementPickId: 2, facePickId: 2 }),
      [0.25, 0.2, 0],
    );
    expect(target?.kind).toBe("face");
    if (target?.kind !== "face") return;
    expect(target.elementId).toBe(1);
    expect(target.nodeIds).toEqual([1, 2, 3]);
    expect(target.neighborElementIds).toEqual([]);
    expect(target.worldPosition).toEqual([0.25, 0.2, 0]);
    expect(target.normal[0]).toBeGreaterThan(0);
  });

  it("resolves a node hit to the most specific target", () => {
    const target = resolvePickHit(
      context,
      ids({ instancePickId: 1, elementPickId: 2, facePickId: 3, nodePickId: 2 }),
      [0, 0, 0],
    );
    expect(target?.kind).toBe("node");
    if (target?.kind !== "node") return;
    expect(target.nodeId).toBe(1);
    expect(target.elementId).toBe(1);
    expect(target.localPosition).toEqual([1, 0, 0]);
    expect(target.worldPosition).toEqual([0, 0, 0]);
  });

  it("transforms node positions by the instance transform", () => {
    const transformed: PickContext = {
      instances: [
        instanceAt(0, 1, new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 0, 0, 1])),
      ],
      parts: new Map([[1, part]]),
    };
    const target = resolvePickHit(
      transformed,
      ids({ instancePickId: 1, elementPickId: 1, facePickId: 1, nodePickId: 1 }),
      [10, 0, 0],
    );
    if (target?.kind !== "node") throw new Error("expected node target");
    expect(target.worldPosition).toEqual([10, 0, 0]);
  });

  it("preserves the exact world hit and computes the normal in world space", () => {
    const transformed: PickContext = {
      instances: [
        instanceAt(0, 1, new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 0, 0, 1])),
      ],
      parts: new Map([[1, part]]),
    };
    const target = resolvePickHit(
      transformed,
      ids({ instancePickId: 1, elementPickId: 2, facePickId: 2 }),
      [9, 0, 0],
    );
    if (target?.kind !== "face") throw new Error("expected face target");
    expect(target.worldPosition).toEqual([9, 0, 0]);
  });

  it("resolves element and node ids from heterogeneous line and point parts", () => {
    const model = createElementModel(
      [0, 0, 0, 1, 0, 0],
      [createElement(5, LINE_SHAPE, [0, 1]), createElement(8, POINT_SHAPE, [1])],
    );
    const lineElement = model.elements[0];
    const pointElement = model.elements[1];
    if (lineElement === undefined || pointElement === undefined)
      throw new Error("elements missing");
    const linePart = elementPart(2, createElementModel([...model.nodes], [lineElement]));
    const pointPart = elementPart(3, createElementModel([...model.nodes], [pointElement]));
    const mixedContext: PickContext = {
      instances: [instanceAt(0, 2), instanceAt(1, 3)],
      parts: new Map([
        [2, linePart],
        [3, pointPart],
      ]),
    };

    expect(
      resolvePickHit(mixedContext, ids({ instancePickId: 1, elementPickId: 6 }), [0, 0, 0]),
    ).toEqual({
      kind: "element",
      partId: 2,
      instanceId: "1/0",
      elementId: 5,
      worldPosition: [0, 0, 0],
    });
    expect(
      resolvePickHit(
        mixedContext,
        ids({ instancePickId: 2, elementPickId: 9, nodePickId: 2 }),
        [0, 0, 0],
      ),
    ).toMatchObject({
      kind: "node",
      partId: 3,
      instanceId: "1/1",
      elementId: 8,
      nodeId: 1,
      localPosition: [1, 0, 0],
    });
  });

  it("leaves element ownership absent for authored node-only point geometry", () => {
    const standalone = createPart(4, {
      geometries: [
        {
          positions: new Float32Array([2, 3, 4]),
          indices: new Uint32Array([0]),
          primitive: "points",
          nodePickIds: new Uint32Array([1]),
        },
      ],
      nodePositions: new Float32Array([2, 3, 4]),
    });
    const standaloneContext: PickContext = {
      instances: [instanceAt(0, 4)],
      parts: new Map([[4, standalone]]),
    };

    expect(
      resolvePickHit(standaloneContext, ids({ instancePickId: 1, nodePickId: 1 }), [2, 3, 4]),
    ).toEqual({
      kind: "node",
      partId: 4,
      instanceId: "1/0",
      nodeId: 0,
      localPosition: [2, 3, 4],
      worldPosition: [2, 3, 4],
      neighborElementIds: [],
      neighborNodeIds: [],
    });
  });
});

describe("resolveEdgePickHit", () => {
  it("returns stable topology and a world-space canonical tangent", () => {
    const edgePart = createPart(1, {
      geometries: [
        {
          positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
          indices: new Uint32Array([0, 1, 2]),
          primitive: "triangles",
          edges: [
            {
              key: "0,1",
              nodeIds: [0, 1],
              incidentElementIds: [3],
              faceRefs: [],
            },
          ],
        },
      ],
      elements: [
        {
          id: 3,
          primitiveRanges: [{ primitive: "triangles", primitiveStart: 0, primitiveCount: 1 }],
        },
      ],
      nodePositions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    });
    const target = resolveEdgePickHit(
      { instances: [instanceAt(0)], parts: new Map([[1, edgePart]]) },
      1,
      "0,1",
      [0.25, 0, 0],
    );
    expect(target).toMatchObject({
      kind: "edge",
      key: "0,1",
      nodeIds: [0, 1],
      incidentElementIds: [3],
      faceRefs: [],
      worldPosition: [0.25, 0, 0],
      tangent: [1, 0, 0],
    });
  });
});

describe("geometryAdjacency", () => {
  const shared = (): ElementModel =>
    createElementModel(
      [...TET_NODES, 0, 0, -1],
      [createElement(1, TET4_SHAPE, [0, 1, 2, 3]), createElement(2, TET4_SHAPE, [0, 1, 2, 4])],
    );

  it("collects neighbor elements and nodes from the face descriptors", () => {
    const geometry = triangleGeometry(shared());
    const adjacency = geometryAdjacency(geometry, 0);
    expect(adjacency.neighborElementIds).toEqual([1, 2]);
    expect(adjacency.neighborNodeIds).toEqual([1, 2, 3, 4]);
  });

  it("returns empty adjacency for an unknown node", () => {
    const geometry = triangleGeometry(tetModel());
    expect(geometryAdjacency(geometry, 99)).toEqual({
      neighborElementIds: [],
      neighborNodeIds: [],
    });
  });
});

describe("interactionTargetFromHit", () => {
  const hit: PickHit = {
    kind: "face",
    partId: 4,
    instanceId: "1/2",
    elementId: 7,
    bodyId: 9,
    blockId: 11,
    faceIndex: 1,
    key: "0,1,2",
    nodeIds: [0, 1, 2],
    neighborElementIds: [8],
    worldPosition: [2, 3, 4],
    normal: [0, 0, 1],
  };

  it.each([
    ["part", { kind: "part", partId: 4 }],
    ["instance", { kind: "instance", instanceId: "1/2" }],
    ["body", { kind: "body", instanceId: "1/2", bodyId: 9 }],
    ["block", { kind: "block", instanceId: "1/2", blockId: 11 }],
    ["element", { kind: "element", instanceId: "1/2", elementId: 7 }],
    ["face", { kind: "face", instanceId: "1/2", elementId: 7, faceIndex: 1 }],
  ] as const)("maps a face hit to %s", (granularity, expected) => {
    expect(interactionTargetFromHit(hit, granularity)).toEqual(expected);
  });

  it("maps a node hit to a node target and rejects unsupported precision", () => {
    const node: PickHit = {
      kind: "node",
      partId: 4,
      instanceId: "1/2",
      elementId: 7,
      nodeId: 2,
      localPosition: [0, 0, 0],
      worldPosition: [2, 3, 4],
      neighborElementIds: [7],
      neighborNodeIds: [1],
    };
    expect(interactionTargetFromHit(node, "node")).toEqual({
      kind: "node",
      instanceId: "1/2",
      nodeId: 2,
    });
    expect(interactionTargetFromHit(node, "face")).toBeUndefined();
    expect(interactionTargetFromHit(node, "body")).toBeUndefined();
  });

  it("does not promote a node-only hit to a fabricated element target", () => {
    const node: PickHit = {
      kind: "node",
      partId: 4,
      instanceId: "1/2",
      nodeId: 2,
      localPosition: [0, 0, 0],
      worldPosition: [2, 3, 4],
      neighborElementIds: [],
      neighborNodeIds: [],
    };

    expect(interactionTargetFromHit(node, "element")).toBeUndefined();
  });
});

describe("validatePickIds", () => {
  it("accepts aligned node and face pick ids", () => {
    const geometry: Geometry = {
      positions: new Float32Array(9),
      indices: new Uint32Array(9),
      primitive: "triangles" as const,
      nodePickIds: new Uint32Array([1, 2, 3]),
      faces: [
        {
          elementId: 0,
          faceIndex: 0,
          primitiveStart: 0,
          primitiveCount: 3,
          key: "0,1,2",
          nodeIds: [0, 1, 2],
          neighborElementIds: [],
        },
      ],
    };
    expect(() => {
      validatePickIds(geometry, undefined, undefined);
    }).not.toThrow();
  });

  it("rejects node pick ids that do not match the vertex count", () => {
    expect(() => {
      validatePickIds(
        {
          positions: new Float32Array(9),
          indices: new Uint32Array(9),
          primitive: "triangles" as const,
          nodePickIds: new Uint32Array([1, 2]),
        },
        undefined,
        undefined,
      );
    }).toThrow("nodePickIds must have one entry per vertex");
  });

  it("rejects face ranges that do not match the triangle count", () => {
    expect(() => {
      validatePickIds(
        {
          positions: new Float32Array(9),
          indices: new Uint32Array(9),
          primitive: "triangles" as const,
          faces: [
            {
              elementId: 0,
              faceIndex: 0,
              primitiveStart: 0,
              primitiveCount: 4,
              key: "0,1,2",
              nodeIds: [0, 1, 2],
              neighborElementIds: [],
            },
          ],
        },
        undefined,
        undefined,
      );
    }).toThrow("outside the triangle buffer");
  });
});
