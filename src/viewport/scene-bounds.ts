import type { Camera } from "../camera/camera";
import { protectCameraWithinBounds } from "../camera/navigation";
import { boundsCorners, isFiniteBounds, type Bounds } from "../geometry/part";
import { selectedTargets } from "../interaction/targets";
import type { InteractionState } from "../interaction/interaction";
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

/** Keeps an externally positioned camera in front of every placed part bound. */
export function protectSceneCamera(
  camera: Camera,
  scene: Scene,
  runtime: PackedSceneRuntime,
): Camera {
  const bounds = sceneWorldBounds(scene, runtime);
  return protectCameraWithinBounds(camera, bounds, sceneWorldBoundsList(scene, runtime));
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
    if (!runtime.isInstanceVisible(slot)) continue;
    const partId = runtime.instancePartIds[slot];
    const transform = runtime.getTransform(slot);
    const part = partId === undefined ? undefined : scene.parts.get(partId);
    if (part === undefined || transform === undefined || !isFiniteBounds(part.bounds)) continue;
    bounds.push(transformedBounds(part.bounds, transform));
  }
  return bounds;
}

/** Returns occurrence bounds for the currently selected visible targets. */
export function selectedSceneBounds(
  scene: Scene,
  runtime: PackedSceneRuntime,
  interaction: InteractionState,
): Bounds | undefined {
  const selectedInstances = new Set<string>();
  const selectedParts = new Set<number>();
  for (const target of selectedTargets(interaction)) {
    if (target.kind === "part") selectedParts.add(target.partId);
    else selectedInstances.add(target.instanceId);
  }
  const bounds = emptyBounds();
  for (let slot = 0; slot < runtime.instanceCount; slot += 1) {
    if (!runtime.isInstanceVisible(slot)) continue;
    const instanceId = runtime.getInstanceId(slot);
    const partId = runtime.instancePartIds[slot];
    if (
      instanceId === undefined ||
      partId === undefined ||
      (!selectedInstances.has(instanceId) && !selectedParts.has(partId))
    ) {
      continue;
    }
    const transform = runtime.getTransform(slot);
    const part = scene.parts.get(partId);
    if (part === undefined || transform === undefined || !isFiniteBounds(part.bounds)) continue;
    includeBounds(bounds, part.bounds, transform);
  }
  return isFiniteBounds(bounds) ? bounds : undefined;
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
  includeBounds(transformed, bounds, transform);
  return transformed;
}

function includeBounds(
  target: MutableBounds,
  bounds: Bounds,
  transform: Parameters<typeof transformPoint>[0],
): void {
  for (const corner of boundsCorners(bounds)) {
    include(target, transformPoint(transform, corner[0], corner[1], corner[2]));
  }
}
