import type { Instance, PickTarget } from "../scene/types";

/** Resolves a 0-based instance slot back to the instance it was drawn from. */
export function resolvePick(instances: readonly Instance[], pickId: number): Instance | undefined {
  if (pickId < 0 || pickId >= instances.length) {
    return undefined;
  }
  return instances[pickId];
}

/**
 * Resolves a GPU pick pixel to a target. Both pick ids are 1-based with `0`
 * meaning "no hit" (matching the GPU instance and element pick records): the
 * instance pick id is the instance slot plus one, the element pick id is the
 * element id plus one. An element target is produced only when both hit.
 */
export function resolvePickTarget(
  instances: readonly Instance[],
  instancePickId: number,
  elementPickId: number,
): PickTarget | undefined {
  const instance = resolvePick(instances, instancePickId - 1);
  if (instance === undefined) {
    return undefined;
  }
  if (elementPickId > 0) {
    return {
      kind: "element",
      partId: instance.partId,
      instanceId: instance.instanceId,
      elementId: elementPickId - 1,
    };
  }
  return { kind: "instance", instanceId: instance.instanceId };
}

/**
 * Maps a resolved instance to a pick target. When a part has multiple
 * instances the caller may prefer the part-level target.
 */
export function instanceToTarget(instance: Instance, preferPart: boolean): PickTarget {
  return preferPart
    ? { kind: "part", partId: instance.partId }
    : { kind: "instance", instanceId: instance.instanceId };
}
