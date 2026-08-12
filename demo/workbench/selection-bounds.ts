import type { Bounds, InteractionState, Scene, SceneRuntime } from "../../src/index";
import { selectedTargets, transformPoint } from "../../src/index";

interface MutableBounds {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

/** Returns world bounds for selected instances and their selected part occurrences. */
export function selectedWorldBounds(
  scene: Scene,
  runtime: SceneRuntime,
  interaction: InteractionState,
): Bounds | undefined {
  const selectedInstances = new Set<string>();
  const selectedParts = new Set<number>();
  for (const target of selectedTargets(interaction)) {
    if (target.kind === "part") selectedParts.add(target.partId);
    else if (target.kind === "instance") selectedInstances.add(target.instanceId);
    else selectedInstances.add(target.instanceId);
  }
  const bounds = emptyBounds();
  for (const instanceId of runtime.getInstanceIds()) {
    const partId = runtime.getPartId(instanceId);
    if (
      partId === undefined ||
      (!selectedInstances.has(instanceId) && !selectedParts.has(partId)) ||
      !runtime.isInstanceVisible(instanceId)
    ) {
      continue;
    }
    const part = scene.parts.get(partId);
    const transform = runtime.getTransform(instanceId);
    if (part === undefined || transform === undefined) continue;
    for (const corner of boundCorners(part.bounds)) {
      include(bounds, transformPoint(transform, corner[0], corner[1], corner[2]));
    }
  }
  return Number.isFinite(bounds.minX) ? bounds : undefined;
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
