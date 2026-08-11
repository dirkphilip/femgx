import type {
  AssemblyNodeId,
  BodyId,
  InstanceId,
  InteractionTarget,
  SceneRuntime,
} from "../../src/index";

/** Semantic identity carried by one visibility-tree row. */
export type VisibilityRowTarget =
  | { readonly kind: "assembly"; readonly nodeId: AssemblyNodeId }
  | { readonly kind: "instance"; readonly instanceId: InstanceId }
  | { readonly kind: "body"; readonly instanceId: InstanceId; readonly bodyId: BodyId };

/** Maps one tree row to the exact scene occurrences it presents. */
export function interactionTargetsForRow(
  runtime: SceneRuntime,
  row: VisibilityRowTarget,
): readonly InteractionTarget[] {
  switch (row.kind) {
    case "instance":
      return [{ kind: "instance", instanceId: row.instanceId }];
    case "body":
      return [row];
    case "assembly":
      return descendantInstanceTargets(runtime, row.nodeId);
  }
}

function descendantInstanceTargets(
  runtime: SceneRuntime,
  rootNodeId: AssemblyNodeId,
): readonly InteractionTarget[] {
  const targets: InteractionTarget[] = [];
  const seenInstances = new Set<InstanceId>();
  const pending: AssemblyNodeId[] = [rootNodeId];
  while (pending.length > 0) {
    const nodeId = pending.pop();
    if (nodeId === undefined) continue;
    const node = runtime.getNode(nodeId);
    if (node === undefined) continue;
    for (const instanceId of node.instanceIds) {
      const instance = runtime.getInstance(instanceId);
      if (instance?.nodeId !== nodeId || seenInstances.has(instanceId)) continue;
      seenInstances.add(instanceId);
      targets.push({ kind: "instance", instanceId });
    }
    for (let index = node.childIds.length - 1; index >= 0; index--) {
      const childId = node.childIds[index];
      if (childId !== undefined) pending.push(childId);
    }
  }
  return targets;
}
