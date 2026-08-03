import type { Instance, PickTarget } from "./types";

/** Resolves a GPU pick id back to the instance it was drawn from. */
export function resolvePick(instances: readonly Instance[], pickId: number): Instance | undefined {
  if (pickId < 0 || pickId >= instances.length) {
    return undefined;
  }
  return instances[pickId];
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
