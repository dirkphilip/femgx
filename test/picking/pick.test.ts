import { describe, expect, it } from "vitest";
import { createElement } from "../../src/elements/element";
import { createElementModel, type ElementModel } from "../../src/elements/model";
import { TET4_SHAPE } from "../../src/elements/shapes";
import { elementGeometry } from "../../src/geometry/element-mesh";
import { computeBounds, validatePickIds, type Geometry, type Part } from "../../src/geometry/part";
import { identity, type Mat4 } from "../../src/math/mat4";
import {
  geometryAdjacency,
  instanceToTarget,
  resolvePick,
  resolvePickTarget,
  type PickContext,
  type ResolvedPickIds,
} from "../../src/picking/pick";
import type { Instance } from "../../src/scene/types";

const TET_NODES: readonly number[] = [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1];

function tetModel(): ElementModel {
  return createElementModel(TET_NODES, [createElement(1, TET4_SHAPE, [0, 1, 2, 3])]);
}

function partWithGeometry(geometry: Geometry): Part {
  return { id: 1, geometry, bounds: computeBounds(geometry) };
}

function instanceAt(index: number, partId = 1, transform: Mat4 = identity()): Instance {
  return { index, instanceId: `1/${index}`, partId, worldTransform: transform };
}

function ids(partial: Partial<ResolvedPickIds>): ResolvedPickIds {
  return { instancePickId: 0, elementPickId: 0, facePickId: 0, nodePickId: 0, ...partial };
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

describe("instanceToTarget", () => {
  it("maps to a part target when preferPart is set", () => {
    const instance = resolvePick([instanceAt(0)], 0);
    if (instance === undefined) throw new Error("expected instance");
    expect(instanceToTarget(instance, true)).toEqual({ kind: "part", partId: 1 });
  });

  it("maps to an instance target by default", () => {
    const instance = resolvePick([instanceAt(0)], 0);
    if (instance === undefined) throw new Error("expected instance");
    expect(instanceToTarget(instance, false)).toEqual({ kind: "instance", instanceId: "1/0" });
  });
});

describe("resolvePickTarget", () => {
  const geometry = elementGeometry(tetModel(), "tet", "solid");
  const part = partWithGeometry(geometry);
  const context: PickContext = { instances: [instanceAt(0)], parts: new Map([[1, part]]) };

  it("resolves an instance-only hit to an instance target", () => {
    expect(resolvePickTarget(context, ids({ instancePickId: 1 }))).toEqual({
      kind: "instance",
      instanceId: "1/0",
    });
  });

  it("resolves an element hit to an element target", () => {
    expect(resolvePickTarget(context, ids({ instancePickId: 1, elementPickId: 2 }))).toEqual({
      kind: "element",
      partId: 1,
      instanceId: "1/0",
      elementId: 1,
    });
  });

  it("returns undefined when the instance pick id misses", () => {
    expect(
      resolvePickTarget(context, ids({ instancePickId: 0, elementPickId: 3 })),
    ).toBeUndefined();
    expect(
      resolvePickTarget(context, ids({ instancePickId: 99, elementPickId: 3 })),
    ).toBeUndefined();
  });

  it("resolves a face hit to a face target with ordered vertices and normal", () => {
    const target = resolvePickTarget(
      context,
      ids({ instancePickId: 1, elementPickId: 2, facePickId: 2 }),
    );
    expect(target?.kind).toBe("face");
    if (target?.kind !== "face") return;
    expect(target.faceId).toBe(1);
    expect(target.elementId).toBe(1);
    expect(target.nodeIds).toEqual([1, 2, 3]);
    expect(target.neighborElementIds).toEqual([]);
    expect(target.hitPosition).toEqual([1 / 3, 1 / 3, 1 / 3]);
    expect(target.normal[0]).toBeGreaterThan(0);
  });

  it("resolves a node hit to the most specific target", () => {
    const target = resolvePickTarget(
      context,
      ids({ instancePickId: 1, elementPickId: 2, facePickId: 3, nodePickId: 2 }),
    );
    expect(target?.kind).toBe("node");
    if (target?.kind !== "node") return;
    expect(target.nodeId).toBe(1);
    expect(target.elementId).toBe(1);
    expect(target.localPosition).toEqual([1, 0, 0]);
    expect(target.worldPosition).toEqual([1, 0, 0]);
  });

  it("narrows a node hit to a requested shallower granularity", () => {
    const target = resolvePickTarget(
      context,
      ids({ instancePickId: 1, elementPickId: 2, facePickId: 3, nodePickId: 2 }),
      "element",
    );
    expect(target).toEqual({ kind: "element", partId: 1, instanceId: "1/0", elementId: 1 });
  });

  it("promotes a node hit to a part target", () => {
    const target = resolvePickTarget(
      context,
      ids({ instancePickId: 1, elementPickId: 2, facePickId: 3, nodePickId: 2 }),
      "part",
    );
    expect(target).toEqual({ kind: "part", partId: 1 });
  });

  it("falls back to the deepest available target for a deeper request", () => {
    const target = resolvePickTarget(context, ids({ instancePickId: 1, elementPickId: 2 }), "node");
    expect(target).toEqual({ kind: "element", partId: 1, instanceId: "1/0", elementId: 1 });
  });

  it("transforms node positions by the instance transform", () => {
    const transformed: PickContext = {
      instances: [
        instanceAt(0, 1, new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 0, 0, 1])),
      ],
      parts: new Map([[1, part]]),
    };
    const target = resolvePickTarget(
      transformed,
      ids({ instancePickId: 1, elementPickId: 1, facePickId: 1, nodePickId: 1 }),
    );
    if (target?.kind !== "node") throw new Error("expected node target");
    expect(target.worldPosition).toEqual([10, 0, 0]);
  });

  it("reports the face centroid and normal in world space", () => {
    const transformed: PickContext = {
      instances: [
        instanceAt(0, 1, new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 0, 0, 1])),
      ],
      parts: new Map([[1, part]]),
    };
    const target = resolvePickTarget(
      transformed,
      ids({ instancePickId: 1, elementPickId: 2, facePickId: 2 }),
    );
    if (target?.kind !== "face") throw new Error("expected face target");
    expect(target.hitPosition).toEqual([5 + 1 / 3, 1 / 3, 1 / 3]);
  });
});

describe("geometryAdjacency", () => {
  const shared = (): ElementModel =>
    createElementModel(
      [...TET_NODES, 0, 0, -1],
      [createElement(1, TET4_SHAPE, [0, 1, 2, 3]), createElement(2, TET4_SHAPE, [0, 1, 2, 4])],
    );

  it("collects neighbor elements and nodes from the face descriptors", () => {
    const geometry = elementGeometry(shared(), "tet", "solid");
    const adjacency = geometryAdjacency(geometry, 0);
    expect(adjacency.neighborElementIds).toEqual([1, 2]);
    expect(adjacency.neighborNodeIds).toEqual([1, 2, 3, 4]);
  });

  it("returns empty adjacency for an unknown node", () => {
    const geometry = elementGeometry(tetModel(), "tet", "solid");
    expect(geometryAdjacency(geometry, 99)).toEqual({
      neighborElementIds: [],
      neighborNodeIds: [],
    });
  });
});

describe("validatePickIds", () => {
  it("accepts aligned node and face pick ids", () => {
    const geometry: Geometry = {
      positions: new Float32Array(9),
      indices: new Uint32Array(9),
      nodePickIds: new Uint32Array([1, 2, 3]),
      facePickIds: new Uint32Array([1, 1, 1]),
      faces: [
        {
          id: 0,
          elementId: 0,
          faceIndex: 0,
          key: "0,1,2",
          nodeIds: [0, 1, 2],
          neighborElementIds: [],
        },
      ],
    };
    expect(() => {
      validatePickIds(geometry);
    }).not.toThrow();
  });

  it("rejects node pick ids that do not match the vertex count", () => {
    expect(() => {
      validatePickIds({
        positions: new Float32Array(9),
        indices: new Uint32Array(9),
        nodePickIds: new Uint32Array([1, 2]),
      });
    }).toThrow("nodePickIds must have one entry per vertex");
  });

  it("rejects face pick ids that do not match the triangle count", () => {
    expect(() => {
      validatePickIds({
        positions: new Float32Array(9),
        indices: new Uint32Array(9),
        facePickIds: new Uint32Array([1, 2]),
      });
    }).toThrow("facePickIds must have one entry per triangle");
  });
});
