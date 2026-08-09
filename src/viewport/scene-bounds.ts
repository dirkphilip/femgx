import type { Bounds } from "../geometry/part";
import { transformPoint } from "../math/mat4";
import type { SceneRuntime } from "../scene-runtime/runtime";
import type { Scene } from "../scene/scene";

interface MutableBounds {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

/** Returns the union of every placed part bound in displayed world space. */
export function sceneWorldBounds(scene: Scene, runtime: SceneRuntime): Bounds {
  const bounds = emptyBounds();
  for (let slot = 0; slot < runtime.instanceCount; slot += 1) {
    const partId = runtime.instancePartIds[slot];
    const transform = runtime.getTransform(slot);
    const part = partId === undefined ? undefined : scene.parts.get(partId);
    if (part === undefined || transform === undefined) continue;
    for (const corner of boundCorners(part.bounds)) {
      include(bounds, transformPoint(transform, corner[0], corner[1], corner[2]));
    }
  }
  return Number.isFinite(bounds.minX)
    ? bounds
    : { minX: -0.5, minY: -0.5, minZ: -0.5, maxX: 0.5, maxY: 0.5, maxZ: 0.5 };
}

function emptyBounds(): MutableBounds {
  return {
    minX: Infinity,
    minY: Infinity,
    minZ: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
    maxZ: -Infinity,
  };
}

function boundCorners(bounds: Bounds): ReadonlyArray<readonly [number, number, number]> {
  return [
    [bounds.minX, bounds.minY, bounds.minZ],
    [bounds.maxX, bounds.minY, bounds.minZ],
    [bounds.minX, bounds.maxY, bounds.minZ],
    [bounds.maxX, bounds.maxY, bounds.minZ],
    [bounds.minX, bounds.minY, bounds.maxZ],
    [bounds.maxX, bounds.minY, bounds.maxZ],
    [bounds.minX, bounds.maxY, bounds.maxZ],
    [bounds.maxX, bounds.maxY, bounds.maxZ],
  ];
}

function include(bounds: MutableBounds, point: readonly [number, number, number]): void {
  bounds.minX = Math.min(bounds.minX, point[0]);
  bounds.minY = Math.min(bounds.minY, point[1]);
  bounds.minZ = Math.min(bounds.minZ, point[2]);
  bounds.maxX = Math.max(bounds.maxX, point[0]);
  bounds.maxY = Math.max(bounds.maxY, point[1]);
  bounds.maxZ = Math.max(bounds.maxZ, point[2]);
}
