import type { Mat4 } from "../math/mat4";
import type { AssemblyDefinition, Placement } from "./assembly";
import type { Scene } from "./scene";

/** Compares assembly values for transaction no-op normalization. */
export function equalAssembly(left: AssemblyDefinition, right: AssemblyDefinition): boolean {
  if (
    left.id !== right.id ||
    left.name !== right.name ||
    left.placements.length !== right.placements.length
  )
    return false;
  return left.placements.every((placement, index) =>
    equalPlacement(placement, right.placements[index]),
  );
}

function equalPlacement(left: Placement, right: Placement | undefined): boolean {
  if (right === undefined || left.kind !== right.kind || left.placementId !== right.placementId)
    return false;
  const sameTarget =
    left.kind === "part"
      ? right.kind === "part" && left.partId === right.partId
      : right.kind === "assembly" && left.assemblyId === right.assemblyId;
  return sameTarget && equalTransform(left.transform, right.transform);
}

/** Compares authored transform components exactly. */
export function equalTransform(left: Mat4, right: Mat4): boolean {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

/** Reports whether a candidate retained every source scene collection. */
export function sameSceneStorage(left: Scene, right: Scene): boolean {
  return (
    left.parts === right.parts &&
    left.assemblies === right.assemblies &&
    left.visiblePartIds === right.visiblePartIds &&
    left.visibleAssemblyIds === right.visibleAssemblyIds
  );
}
