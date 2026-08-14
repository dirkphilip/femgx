import { createSceneRuntime, transformPoint, type Bounds, type Scene } from "../../src/index";

/** Returns the union of all placed part bounds for a demo preset. */
export function fixtureBounds(scene: Scene): Bounds {
  const runtime = createSceneRuntime(scene);
  let result: Bounds | undefined;
  for (const instanceId of runtime.getDrawList()) {
    const partId = runtime.getPartId(instanceId);
    const transform = runtime.getTransform(instanceId);
    const part = partId === undefined ? undefined : scene.parts.get(partId);
    if (part === undefined || transform === undefined) continue;
    result = mergeBounds(result, transformBounds(part.bounds, transform));
  }
  if (result === undefined) throw new Error("Preset scene must contain at least one part");
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
