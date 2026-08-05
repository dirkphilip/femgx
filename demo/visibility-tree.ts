import type { Assembly, AssemblyId, SceneRuntime } from "../src/index";

/**
 * Aggregate visibility of an assembly subtree as a tri-state checkbox value.
 * Assembly controls reflect assembly state only; part controls reflect part
 * state, so the two namespaces never infer meaning from a shared numeric id.
 */
export type AssemblyVisibilityState = "checked" | "unchecked" | "mixed";

/**
 * The assembly and every nested sub-assembly beneath it, in deterministic
 * pre-order. The result always includes `assemblyId` itself.
 */
export function assemblySubtreeIds(
  assemblies: ReadonlyMap<AssemblyId, Assembly>,
  assemblyId: AssemblyId,
): readonly AssemblyId[] {
  const result: AssemblyId[] = [];
  const visited = new Set<AssemblyId>();
  const stack: AssemblyId[] = [assemblyId];
  while (stack.length > 0) {
    const id = stack.pop();
    if (id === undefined || visited.has(id)) {
      continue;
    }
    visited.add(id);
    result.push(id);
    const assembly = assemblies.get(id);
    const placements = assembly?.placements ?? [];
    for (let index = placements.length - 1; index >= 0; index--) {
      const placement = placements[index];
      if (placement !== undefined && placement.kind === "assembly") {
        stack.push(placement.assemblyId);
      }
    }
  }
  return result;
}

/**
 * Aggregates the effective visibility of every assembly expansion in the
 * subtree, so a parent row can reflect its descendants as checked, unchecked,
 * or mixed. Ancestor gating is included, so a subtree under a hidden assembly
 * reads unchecked even when its own authoring bits are on.
 */
export function assemblyVisibilityState(
  runtime: SceneRuntime,
  assemblyId: AssemblyId,
): AssemblyVisibilityState {
  const { nodeAssemblyIds, nodeEffectiveVisible, nodeFirstChild, nodeNextSibling } = runtime;
  let total = 0;
  let visible = 0;
  for (let node = 0; node < runtime.nodeCount; node++) {
    if (nodeAssemblyIds[node] !== assemblyId) {
      continue;
    }
    const stack: number[] = [node];
    while (stack.length > 0) {
      const current = stack.pop();
      if (current === undefined) {
        continue;
      }
      total += 1;
      if (nodeEffectiveVisible[current] === 1) {
        visible += 1;
      }
      const firstChild = nodeFirstChild[current];
      let child = firstChild ?? -1;
      while (child !== -1) {
        stack.push(child);
        const next = nodeNextSibling[child];
        child = next ?? -1;
      }
    }
  }
  if (total === 0 || visible === 0) {
    return "unchecked";
  }
  if (visible === total) {
    return "checked";
  }
  return "mixed";
}

/** The display name of a registered assembly, when it carries one. */
export function assemblyName(assembly: Assembly | undefined): string | undefined {
  if (assembly === undefined) {
    return undefined;
  }
  return (assembly as { readonly name?: string }).name;
}
