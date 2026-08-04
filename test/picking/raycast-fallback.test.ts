import { describe, expect, it } from "vitest";
import { createElement } from "../../src/elements/element";
import { createElementModel, type ElementModel } from "../../src/elements/model";
import { TET4_SHAPE } from "../../src/elements/shapes";
import { createCamera } from "../../src/camera/camera";
import { elementPart } from "../../src/geometry/element-mesh";
import type { Part } from "../../src/geometry/part";
import { identity } from "../../src/math/mat4";
import { pickFromRay, rayFromPixel, type Ray as PickRay } from "../../src/picking/raycast-fallback";
import type { Instance, PickTarget } from "../../src/scene/types";

const TET_NODES: readonly number[] = [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1];

function tetModel(): ElementModel {
  return createElementModel(TET_NODES, [createElement(1, TET4_SHAPE, [0, 1, 2, 3])]);
}

function buildContext() {
  const part = elementPart(1, tetModel(), "tet", "solid");
  const instance: Instance = { index: 0, instanceId: "1/0", partId: 1, worldTransform: identity() };
  return { context: { instances: [instance], parts: new Map([[1, part]]) }, part, instance };
}

/** A ray through the slanted top face of the tet, hitting it exactly. */
function hitRay(): PickRay {
  return { origin: [0.25, 0.25, 1], direction: [0, 0, -1] };
}

describe("pickFromRay", () => {
  it("resolves a hit to the most-specific node target", () => {
    const { context } = buildContext();
    const target = pickFromRay(context, hitRay());
    expect(target?.kind).toBe("node");
    if (target?.kind !== "node") return;
    expect(target.nodeId).toBe(3);
    expect(target.elementId).toBe(1);
    expect(target.localPosition).toEqual([0, 0, 1]);
    expect(target.worldPosition).toEqual([0, 0, 1]);
    expect(target.neighborElementIds).toEqual([1]);
  });

  it("returns a face target with the exact hit position at face granularity", () => {
    const { context } = buildContext();
    const target = pickFromRay(context, hitRay(), { granularity: "face" });
    expect(target?.kind).toBe("face");
    if (target?.kind !== "face") return;
    expect(target.hitPosition).toEqual([0.25, 0.25, 0.5]);
    expect(target.normal[0]).toBeCloseTo(0.577, 2);
  });

  it("returns an element target at element granularity", () => {
    const { context } = buildContext();
    const target = pickFromRay(context, hitRay(), { granularity: "element" });
    expect(target).toEqual({ kind: "element", partId: 1, instanceId: "1/0", elementId: 1 });
  });

  it("returns undefined when the ray misses everything", () => {
    const { context } = buildContext();
    expect(pickFromRay(context, { origin: [10, 10, 10], direction: [0, 0, -1] })).toBeUndefined();
  });

  it("respects the visible instance filter", () => {
    const { context } = buildContext();
    const target = pickFromRay(context, hitRay(), { visibleInstanceIds: new Set([99]) });
    expect(target).toBeUndefined();
  });

  it("transforms geometry by the instance world transform", () => {
    const { context, instance } = buildContext();
    instance.worldTransform.set(
      new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 0, 0, 1]),
    );
    const target = pickFromRay(context, { origin: [10.25, 0.25, 1], direction: [0, 0, -1] });
    expect(target?.kind).toBe("node");
    if (target?.kind !== "node") return;
    expect(target.worldPosition).toEqual([10, 0, 1]);
  });
});

describe("pickFromRay granularity fallback", () => {
  it("falls back to the deepest available when requesting a deeper level", () => {
    const { context } = buildContext();
    const target = pickFromRay(context, hitRay(), { granularity: "node" });
    expect(target?.kind).toBe("node");
  });

  it("never reports a face when the hit supports only elements", () => {
    const part = elementPart(1, tetModel(), "tet", "solid");
    const { faces: _faces, facePickIds: _facePickIds, ...geometry } = part.geometry;
    const stripped: Part = { ...part, geometry };
    const instance: Instance = {
      index: 0,
      instanceId: "1/0",
      partId: 1,
      worldTransform: identity(),
    };
    const context = { instances: [instance], parts: new Map([[1, stripped]]) } as const;
    const target = pickFromRay(context, hitRay(), { granularity: "face" });
    expect(target).toBeUndefined();
  });
});

describe("rayFromPixel", () => {
  it("casts the center pixel through the camera target direction", () => {
    const camera = createCamera({
      position: [0, 0, 5],
      target: [0, 0, 0],
      width: 100,
      height: 100,
    });
    const ray = rayFromPixel(camera, 50, 50);
    expect(ray.origin).toEqual([0, 0, 5]);
    expect(ray.direction[0]).toBeCloseTo(0, 9);
    expect(ray.direction[1]).toBeCloseTo(0, 9);
    expect(ray.direction[2]).toBeCloseTo(-1, 9);
  });

  it("offsets the origin along the view plane in orthographic mode", () => {
    const camera = createCamera({
      mode: "orthographic",
      position: [0, 0, 5],
      target: [0, 0, 0],
      orthoHeight: 6,
      width: 100,
      height: 100,
    });
    const ray = rayFromPixel(camera, 0, 50);
    expect(ray.direction[2]).toBeCloseTo(-1, 9);
    expect(ray.origin[0]).toBeCloseTo(-3, 6);
    expect(ray.origin[1]).toBeCloseTo(0, 9);
  });
});

describe("pickFromRay pick target shape", () => {
  it("is renderer-independent across CPU and GPU resolution", () => {
    const { context } = buildContext();
    const target = pickFromRay(context, hitRay(), { granularity: "instance" });
    expect(target).toEqual<PickTarget>({ kind: "instance", instanceId: "1/0" });
  });
});
