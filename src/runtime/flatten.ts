import type { Assembly } from "../scene/assembly";
import { identity, multiply, type Mat4 } from "../math/mat4";
import type { AssemblyId, Instance, PartId } from "../scene/types";

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

interface WalkItem {
  readonly assemblyId: AssemblyId;
  readonly parentTransform: Mat4;
  readonly path: string;
  nextPlacementIndex: number;
}

/**
 * Flattens an assembly tree into a deterministic, depth-first instance list.
 * Hidden assemblies and parts are culled at the source so hidden geometry is
 * never drawn. Visible draw indices are compacted; `instanceId` keeps the source
 * placement identity stable when visibility changes.
 */
export function flattenAssembly(options: FlattenOptions): readonly Instance[] {
  const instances: Instance[] = [];
  const stack: WalkItem[] = [
    {
      assemblyId: options.assemblyId,
      parentTransform: identity(),
      path: String(options.assemblyId),
      nextPlacementIndex: 0,
    },
  ];
  while (stack.length > 0) {
    const item = stack[stack.length - 1];
    if (item === undefined) {
      continue;
    }
    const assembly = options.assemblies.get(item.assemblyId);
    if (assembly === undefined || !options.visibleAssemblyIds.has(item.assemblyId)) {
      stack.pop();
      continue;
    }
    if (item.nextPlacementIndex >= assembly.placements.length) {
      stack.pop();
      continue;
    }
    const placementIndex = item.nextPlacementIndex;
    item.nextPlacementIndex += 1;
    const placement = assembly.placements[placementIndex];
    if (placement === undefined) {
      continue;
    }
    const worldTransform = multiply(item.parentTransform, placement.transform);
    const placementPath = `${item.path}/${placementIndex}`;
    if (placement.kind === "assembly") {
      stack.push({
        assemblyId: placement.assemblyId,
        parentTransform: worldTransform,
        path: placementPath,
        nextPlacementIndex: 0,
      });
    } else if (options.visiblePartIds.has(placement.partId)) {
      instances.push({
        index: instances.length,
        instanceId: placementPath,
        partId: placement.partId,
        worldTransform,
      });
    }
  }
  return instances;
}
