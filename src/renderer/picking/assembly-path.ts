import type { PickAssemblyPathEntry } from "../../picking/types";
import type { PackedSceneRuntime } from "../../scene-runtime/runtime";

/** Resolves one instance's root-to-direct-owner assembly path from packed state. */
export function assemblyPathForInstance(
  runtime: PackedSceneRuntime,
  instanceSlot: number,
): readonly PickAssemblyPathEntry[] {
  const path: PickAssemblyPathEntry[] = [];
  let node = runtime.instanceOwningNode[instanceSlot] ?? -1;
  while (node >= 0) {
    const assemblyOccurrenceId = runtime.getNodeId(node);
    const assemblyId = runtime.nodeAssemblyIds[node];
    if (assemblyOccurrenceId !== undefined && assemblyId !== undefined) {
      path.push({ assemblyId, assemblyOccurrenceId });
    }
    node = runtime.nodeParents[node] ?? -1;
  }
  path.reverse();
  return path;
}
