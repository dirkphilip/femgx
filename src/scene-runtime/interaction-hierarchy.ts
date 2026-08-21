import type { AssemblyId, AssemblyOccurrenceId } from "../scene/types";
import type { PackedSceneRuntime } from "./runtime";

/** Returns whether one packed instance is owned by either assembly target. */
export function instanceMatchesAssemblyTarget(
  runtime: PackedSceneRuntime,
  instanceSlot: number,
  assemblyIds: ReadonlySet<AssemblyId>,
  assemblyOccurrenceIds: ReadonlySet<AssemblyOccurrenceId>,
): boolean {
  let node = runtime.instanceOwningNode[instanceSlot] ?? -1;
  while (node >= 0) {
    const occurrenceId = runtime.getNodeId(node);
    if (
      (occurrenceId !== undefined && assemblyOccurrenceIds.has(occurrenceId)) ||
      assemblyIds.has(runtime.nodeAssemblyIds[node] ?? -1)
    ) {
      return true;
    }
    node = runtime.nodeParents[node] ?? -1;
  }
  return false;
}

/** Returns whether one packed instance is under an assembly definition. */
export function instanceMatchesAssemblyId(
  runtime: PackedSceneRuntime,
  instanceSlot: number,
  assemblyId: AssemblyId,
): boolean {
  let node = runtime.instanceOwningNode[instanceSlot] ?? -1;
  while (node >= 0) {
    if (runtime.nodeAssemblyIds[node] === assemblyId) return true;
    node = runtime.nodeParents[node] ?? -1;
  }
  return false;
}

/** Returns whether one packed instance is under an assembly occurrence. */
export function instanceMatchesAssemblyOccurrence(
  runtime: PackedSceneRuntime,
  instanceSlot: number,
  assemblyOccurrenceId: AssemblyOccurrenceId,
): boolean {
  let node = runtime.instanceOwningNode[instanceSlot] ?? -1;
  while (node >= 0) {
    if (runtime.getNodeId(node) === assemblyOccurrenceId) return true;
    node = runtime.nodeParents[node] ?? -1;
  }
  return false;
}

/** Visits descendant instance slots without creating descendant interaction targets. */
export function forEachInstanceUnderAssemblyTargets(
  runtime: PackedSceneRuntime,
  assemblyIds: ReadonlySet<AssemblyId>,
  assemblyOccurrenceIds: ReadonlySet<AssemblyOccurrenceId>,
  visit: (instanceSlot: number) => void,
): void {
  const nodes = new Set<number>();
  for (const assemblyId of assemblyIds) {
    for (const node of runtime.getAssemblyNodeSlots(assemblyId)) nodes.add(node);
  }
  for (const occurrenceId of assemblyOccurrenceIds) {
    const node = runtime.getNodeSlot(occurrenceId);
    if (node !== undefined) nodes.add(node);
  }
  const visitedNodes = new Set<number>();
  const visitedInstances = new Set<number>();
  for (const node of nodes) visitNode(runtime, node, visitedNodes, visitedInstances, visit);
}

function visitNode(
  runtime: PackedSceneRuntime,
  node: number,
  visitedNodes: Set<number>,
  visitedInstances: Set<number>,
  visit: (instanceSlot: number) => void,
): void {
  if (node < 0 || visitedNodes.has(node)) return;
  visitedNodes.add(node);
  for (const instance of runtime.getNodeInstanceSlots(node)) {
    if (visitedInstances.has(instance)) continue;
    visitedInstances.add(instance);
    visit(instance);
  }
  let child = runtime.nodeFirstChild[node] ?? -1;
  while (child >= 0) {
    visitNode(runtime, child, visitedNodes, visitedInstances, visit);
    child = runtime.nodeNextSibling[child] ?? -1;
  }
}
