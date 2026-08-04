import { describe, expect, it } from "vitest";
import { createCamera, resizeCamera, viewProjectionMatrix } from "../../src/camera/camera";
import { computeBounds, type Part } from "../../src/geometry/part";
import { identity, type Mat4 } from "../../src/math/mat4";
import { cullInstances, extractFrustum, isSphereVisible } from "../../src/runtime/culling";
import type { Instance } from "../../src/scene/types";

function part(id: number, x: number, y: number, z: number): Part {
  const geometry = { positions: new Float32Array([x, y, z]), indices: new Uint32Array() };
  return { id, geometry, bounds: computeBounds(geometry) };
}

function instance(id: string, partId: number, worldTransform: Mat4): Instance {
  return { index: 0, instanceId: id, partId, worldTransform };
}

describe("extractFrustum", () => {
  const camera = resizeCamera(
    createCamera({ position: [0, 0, 0], target: [0, 0, -1], near: 1, far: 100 }),
    800,
    600,
  );
  const frustum = extractFrustum(viewProjectionMatrix(camera));

  it("keeps points at the near and far planes visible", () => {
    expect(isSphereVisible(frustum, [0, 0, -1], 0)).toBe(true);
    expect(isSphereVisible(frustum, [0, 0, -100], 0)).toBe(true);
  });

  it("culls points closer than the near plane", () => {
    expect(isSphereVisible(frustum, [0, 0, -0.8], 0)).toBe(false);
  });

  it("culls points beyond the far plane", () => {
    expect(isSphereVisible(frustum, [0, 0, -100.5], 0)).toBe(false);
  });
});

describe("cullInstances", () => {
  const camera = resizeCamera(
    createCamera({ position: [0, 0, 0], target: [0, 0, -1], near: 1, far: 100 }),
    800,
    600,
  );
  const viewProjection = viewProjectionMatrix(camera);

  it("keeps in-frustum instances and culls near/far outliers", () => {
    const parts = new Map<number, Part>();
    const addPart = (id: number, x: number, y: number, z: number): Part => {
      const created = part(id, x, y, z);
      parts.set(id, created);
      return created;
    };
    const inside = addPart(1, 0, 0, -5);
    const tooClose = addPart(2, 0, 0, -0.8);
    const tooFar = addPart(3, 0, 0, -100.5);
    const instances = [
      instance("1", inside.id, identity()),
      instance("2", tooClose.id, identity()),
      instance("3", tooFar.id, identity()),
    ];
    const visible = cullInstances(instances, parts, viewProjection);
    expect(visible.map((item) => item.instanceId)).toEqual(["1"]);
  });
});
