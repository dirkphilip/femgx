import { boundsCorners, isFiniteBounds, type Bounds } from "../geometry/part";
import { transformPoint } from "../math/mat4";
import type { PackedSceneRuntime } from "../scene-runtime/runtime";
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
export function sceneWorldBounds(scene: Scene, runtime: PackedSceneRuntime): Bounds {
  const bounds = emptyBounds();
  for (const partBounds of sceneWorldBoundsList(scene, runtime)) {
    for (const corner of boundsCorners(partBounds)) include(bounds, corner);
  }
  return isFiniteBounds(bounds)
    ? bounds
    : { minX: -0.5, minY: -0.5, minZ: -0.5, maxX: 0.5, maxY: 0.5, maxZ: 0.5 };
}

/** Returns each placed part bound separately in displayed world space. */
export function sceneWorldBoundsList(scene: Scene, runtime: PackedSceneRuntime): readonly Bounds[] {
  const bounds: Bounds[] = [];
  for (let slot = 0; slot < runtime.instanceCount; slot += 1) {
    const partId = runtime.instancePartIds[slot];
    const transform = runtime.getTransform(slot);
    const part = partId === undefined ? undefined : scene.parts.get(partId);
    if (part === undefined || transform === undefined || !isFiniteBounds(part.bounds)) continue;
    bounds.push(transformedBounds(part.bounds, transform));
  }
  return bounds;
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

function include(bounds: MutableBounds, point: readonly [number, number, number]): void {
  bounds.minX = Math.min(bounds.minX, point[0]);
  bounds.minY = Math.min(bounds.minY, point[1]);
  bounds.minZ = Math.min(bounds.minZ, point[2]);
  bounds.maxX = Math.max(bounds.maxX, point[0]);
  bounds.maxY = Math.max(bounds.maxY, point[1]);
  bounds.maxZ = Math.max(bounds.maxZ, point[2]);
}

function transformedBounds(
  bounds: Bounds,
  transform: Parameters<typeof transformPoint>[0],
): Bounds {
  const transformed = emptyBounds();
  for (const corner of boundsCorners(bounds)) {
    include(transformed, transformPoint(transform, corner[0], corner[1], corner[2]));
  }
  return transformed;
}
