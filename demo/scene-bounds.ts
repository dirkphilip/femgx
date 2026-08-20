import {
  identityMatrix,
  multiplyMatrices,
  transformPoint,
  type Bounds,
  type Scene,
} from "../src/entries/root";

/** Returns the union of all placed part bounds in a demo scene. */
export function sceneBounds(
  scene: Scene,
  emptyMessage = "Preset scene must contain at least one part",
): Bounds {
  let result: Bounds | undefined;
  const visitAssembly = (assemblyId: number, parentTransform: Float32Array): void => {
    const assembly = scene.assemblies.get(assemblyId);
    if (assembly === undefined || !scene.visibleAssemblyIds.has(assemblyId)) return;
    for (const placement of assembly.placements) {
      const transform = multiplyMatrices(parentTransform, placement.transform);
      if (placement.kind === "assembly") visitAssembly(placement.assemblyId, transform);
      else {
        const part = scene.parts.get(placement.partId);
        if (part !== undefined && scene.visiblePartIds.has(part.id)) {
          result = mergeBounds(result, transformBounds(part.bounds, transform));
        }
      }
    }
  };
  visitAssembly(scene.rootAssemblyId, identityMatrix());
  if (result === undefined) throw new Error(emptyMessage);
  return result;
}

function transformBounds(bounds: Bounds, transform: Float32Array): Bounds {
  let result: Bounds = {
    minX: Infinity,
    minY: Infinity,
    minZ: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
    maxZ: -Infinity,
  };
  for (const x of [bounds.minX, bounds.maxX]) {
    for (const y of [bounds.minY, bounds.maxY]) {
      for (const z of [bounds.minZ, bounds.maxZ]) {
        const [px, py, pz] = transformPoint(transform, x, y, z);
        result = {
          minX: Math.min(result.minX, px),
          minY: Math.min(result.minY, py),
          minZ: Math.min(result.minZ, pz),
          maxX: Math.max(result.maxX, px),
          maxY: Math.max(result.maxY, py),
          maxZ: Math.max(result.maxZ, pz),
        };
      }
    }
  }
  return result;
}

function mergeBounds(first: Bounds | undefined, second: Bounds): Bounds {
  if (first === undefined) return second;
  return {
    minX: Math.min(first.minX, second.minX),
    minY: Math.min(first.minY, second.minY),
    minZ: Math.min(first.minZ, second.minZ),
    maxX: Math.max(first.maxX, second.maxX),
    maxY: Math.max(first.maxY, second.maxY),
    maxZ: Math.max(first.maxZ, second.maxZ),
  };
}
