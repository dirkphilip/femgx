import type {
  AssemblyOccurrenceId,
  BodyId,
  InstanceId,
  InteractionTarget,
  SceneRuntime,
} from "../../src/index";

/** Semantic identity carried by one visibility-tree row. */
export type VisibilityRowTarget =
  | { readonly kind: "assembly"; readonly occurrenceId: AssemblyOccurrenceId }
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
      return descendantInstanceTargets(runtime, row.occurrenceId);
  }
}

function descendantInstanceTargets(
  runtime: SceneRuntime,
  rootOccurrenceId: AssemblyOccurrenceId,
): readonly InteractionTarget[] {
  const targets: InteractionTarget[] = [];
  const seenInstances = new Set<InstanceId>();
  const pending: AssemblyOccurrenceId[] = [rootOccurrenceId];
  while (pending.length > 0) {
    const occurrenceId = pending.pop();
    if (occurrenceId === undefined) continue;
    const occurrence = runtime.getOccurrence(occurrenceId);
    if (occurrence === undefined) continue;
    for (const instanceId of occurrence.instanceIds) {
      const instance = runtime.getInstance(instanceId);
      if (instance?.occurrenceId !== occurrenceId || seenInstances.has(instanceId)) continue;
      seenInstances.add(instanceId);
      targets.push({ kind: "instance", instanceId });
    }
    for (let index = occurrence.childIds.length - 1; index >= 0; index--) {
      const childId = occurrence.childIds[index];
      if (childId !== undefined) pending.push(childId);
    }
  }
  return targets;
}
