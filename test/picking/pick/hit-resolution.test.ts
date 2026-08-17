import { describe, expect, it } from "vitest";
import {
  TET_NODES,
  instanceAt,
  ids,
  geometry,
  part,
  context,
  createElement,
  createElementModel,
  ElementShape,
  elementPart,
  createPart,
  type TriangleGeometry,
  resolvePick,
  resolvePickHit,
  type PickContext,
} from "./support";

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

  it("falls back to the owning element for renderer-private cap node ids", () => {
    expect(
      resolvePickHit(
        context,
        ids({ instancePickId: 1, elementPickId: 2, nodePickId: 99 }),
        [0, 0, 0],
      ),
    ).toEqual({
      kind: "element",
      partId: 1,
      instanceId: "1/0",
      elementId: 1,
      worldPosition: [0, 0, 0],
    });
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
      [createElement(5, ElementShape.Line, [0, 1]), createElement(8, ElementShape.Point, [1])],
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
