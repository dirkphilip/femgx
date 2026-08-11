import type { BodyId, InstanceId, InteractionTarget, PartId, PickTarget } from "../src/index";

/** The interaction granularity a modifier key can select at. */
export type PickLevel = "node" | "face" | "element" | "instance" | "part";

/** A stable selection identity at any supported granularity. */
export type SelectTarget = Exclude<InteractionTarget, { readonly kind: "body" }> & {
  readonly bodyId?: BodyId;
};

/** Resolves an instance id to its part id for inspection and target labeling. */
export type PartIdForInstance = (instanceId: InstanceId) => PartId | undefined;

/**
 * Maps a GPU pick target to the selection target the modifier keys select at:
 * no modifier keeps the most specific hit, shift promotes to the element,
 * and alt to the instance. Control/Meta are selection-mode modifiers and do
 * not change the target granularity.
 */
export function selectTarget(
  hit: PickTarget,
  modifiers: {
    readonly shiftKey: boolean;
    readonly altKey: boolean;
    readonly ctrlKey: boolean;
    readonly metaKey: boolean;
  },
): SelectTarget | undefined {
  if (modifiers.altKey) {
    if (hit.kind === "part") return { kind: "part", partId: hit.partId };
    return { kind: "instance", instanceId: hit.instanceId };
  }
  if (modifiers.shiftKey) {
    if (hit.kind === "node") {
      const elementId = hit.neighborElementIds[0] ?? hit.elementId;
      return {
        kind: "element",
        instanceId: hit.instanceId,
        elementId,
        ...optionalBodyId(hit.bodyId),
      };
    }
    if (hit.kind === "face") {
      return {
        kind: "element",
        instanceId: hit.instanceId,
        elementId: hit.elementId,
        ...optionalBodyId(hit.bodyId),
      };
    }
    if (hit.kind === "element") {
      return {
        kind: "element",
        instanceId: hit.instanceId,
        elementId: hit.elementId,
        ...optionalBodyId(hit.bodyId),
      };
    }
  }
  if (hit.kind === "node") {
    return {
      kind: "node",
      instanceId: hit.instanceId,
      nodeId: hit.nodeId,
      ...optionalBodyId(hit.bodyId),
    };
  }
  if (hit.kind === "face") {
    return {
      kind: "face",
      instanceId: hit.instanceId,
      elementId: hit.elementId,
      key: hit.key,
      ...optionalBodyId(hit.bodyId),
    };
  }
  if (hit.kind === "element") {
    return {
      kind: "element",
      instanceId: hit.instanceId,
      elementId: hit.elementId,
      ...optionalBodyId(hit.bodyId),
    };
  }
  if (hit.kind === "instance") return { kind: "instance", instanceId: hit.instanceId };
  return { kind: "part", partId: hit.partId };
}

function optionalBodyId(
  bodyId: BodyId | undefined,
): { readonly bodyId: BodyId } | Record<never, never> {
  return bodyId === undefined ? {} : { bodyId };
}

/** Stable dataset key for a resolved pick or selection target. */
export function targetKey(target: PickTarget | SelectTarget | undefined): string {
  if (target === undefined) return "";
  switch (target.kind) {
    case "node":
      return `n:${target.instanceId}:${target.nodeId}`;
    case "face":
      return `f:${target.instanceId}:${target.elementId}:${target.key}`;
    case "element":
      return `e:${target.instanceId}:${target.elementId}`;
    case "instance":
      return `i:${target.instanceId}`;
    case "part":
      return `p:${target.partId}`;
  }
}
