import type { Assembly } from "./assembly";
import { identity, multiply, type Mat4 } from "./mat4";
import type { AssemblyId, Instance, PartId } from "./types";

/**
 * Resolved visibility for a placement: a node is visible only if every
 * ancestor in the hierarchy is visible (bottom-up inheritance).
 */
export interface FlattenOptions {
  readonly assemblyId: AssemblyId;
  readonly assemblies: ReadonlyMap<AssemblyId, Assembly>;
  readonly visibleAssemblyIds: ReadonlySet<AssemblyId>;
  readonly visiblePartIds: ReadonlySet<PartId>;
}

function walkAssembly(
  options: FlattenOptions,
  id: AssemblyId,
  parentTransform: Mat4,
  instances: Instance[],
): void {
  const assembly = options.assemblies.get(id);
  if (assembly === undefined || !options.visibleAssemblyIds.has(id)) {
    return;
  }
  for (const placement of assembly.placements) {
    const worldTransform = multiply(parentTransform, placement.transform);
    if (placement.kind === "part") {
      if (!options.visiblePartIds.has(placement.partId)) {
        continue;
      }
      instances.push({
        index: instances.length,
        partId: placement.partId,
        worldTransform,
      });
    } else {
      walkAssembly(options, placement.assemblyId, worldTransform, instances);
    }
  }
}

/**
 * Flattens an assembly tree into a deterministic, depth-first instance list.
 * Hidden assemblies and parts are culled at the source so hidden geometry is
 * never drawn and instance indices stay stable frame to frame.
 */
export function flattenAssembly(options: FlattenOptions): readonly Instance[] {
  const instances: Instance[] = [];
  walkAssembly(options, options.assemblyId, identity(), instances);
  return instances;
}
