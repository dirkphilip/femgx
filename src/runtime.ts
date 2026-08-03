import { batchInstancesByPart, type InstanceBatch } from "./batch";
import { flattenAssembly } from "./flatten";
import { cullInstances } from "./culling";
import type { Mat4 } from "./mat4";
import type { Scene } from "./scene";
import type { Instance } from "./types";

/** Deterministic CPU snapshot prepared for a renderer frame. */
export interface CompiledScene {
  readonly instances: readonly Instance[];
  readonly batches: readonly InstanceBatch[];
}

/** Optional frame-specific compilation inputs. */
export interface CompileOptions {
  readonly viewProjection?: Mat4;
}

/** Compiles a scene into stable visible instances and per-part draw batches. */
export function compileScene(scene: Scene, options: CompileOptions = {}): CompiledScene {
  const flattened = flattenAssembly({
    assemblyId: scene.rootAssemblyId,
    assemblies: scene.assemblies,
    visibleAssemblyIds: scene.visibleAssemblyIds,
    visiblePartIds: scene.visiblePartIds,
  });
  const instances =
    options.viewProjection === undefined
      ? flattened
      : cullInstances(flattened, scene.parts, options.viewProjection);
  return { instances, batches: batchInstancesByPart(instances) };
}
