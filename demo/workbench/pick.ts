import {
  interactionTargetFromHit,
  type ElementId,
  type BodyId,
  type InteractionGranularity,
  type InteractionTarget,
  type PickHit,
} from "../../src/index";

/** The interaction granularity a modifier key can select at. */
export type PickLevel = "node" | "face" | "element" | "instance" | "part";

/** A stable selection identity at any supported granularity. */
export type SelectTarget = Exclude<InteractionTarget, { readonly kind: "body" }> & {
  readonly bodyId?: BodyId;
  /** The exact element owning a node pick, retained for context actions. */
  readonly elementId?: ElementId;
};

/**
 * Maps a GPU pick target to the selection target the modifier keys select at:
 * no modifier keeps the most specific hit, shift promotes to the element,
 * and alt to the instance. Control/Meta are selection-mode modifiers and do
 * not change the target granularity.
 */
export function selectTarget(
  hit: PickHit,
  modifiers: {
    readonly shiftKey: boolean;
    readonly altKey: boolean;
    readonly ctrlKey: boolean;
    readonly metaKey: boolean;
  },
): SelectTarget | undefined {
  const granularity: InteractionGranularity = modifiers.altKey ? "instance" : hit.kind;
  const target = interactionTargetFromHit(hit, granularity);
  if (target === undefined || target.kind === "body") return undefined;
  const selectedTarget: SelectTarget = {
    ...target,
    ...(target.kind === "element" || target.kind === "face" || target.kind === "node"
      ? optionalBodyId("bodyId" in hit ? hit.bodyId : undefined)
      : {}),
    ...(target.kind === "node"
      ? optionalElementId("elementId" in hit ? hit.elementId : undefined)
      : {}),
  };
  return modifiers.shiftKey && !modifiers.altKey ? elementTarget(selectedTarget) : selectedTarget;
}

function optionalBodyId(
  bodyId: BodyId | undefined,
): { readonly bodyId: BodyId } | Record<never, never> {
  return bodyId === undefined ? {} : { bodyId };
}

function optionalElementId(
  elementId: ElementId | undefined,
): { readonly elementId: ElementId } | Record<never, never> {
  return elementId === undefined ? {} : { elementId };
}

/** Promotes an element-owned pick to its exact owning element identity. */
export function elementTarget(target: SelectTarget): SelectTarget | undefined {
  switch (target.kind) {
    case "node":
      return target.elementId === undefined
        ? undefined
        : { kind: "element", instanceId: target.instanceId, elementId: target.elementId };
    case "face":
    case "element":
      return { kind: "element", instanceId: target.instanceId, elementId: target.elementId };
    case "instance":
    case "part":
      return undefined;
  }
}

/** Stable dataset key for a resolved pick or selection target. */
export function targetKey(target: PickHit | SelectTarget | undefined): string {
  if (target === undefined) return "";
  switch (target.kind) {
    case "node":
      return `n:${target.instanceId}:${target.nodeId}`;
    case "face":
      return `f:${target.instanceId}:${target.elementId}:${target.faceIndex}`;
    case "element":
      return `e:${target.instanceId}:${target.elementId}`;
    case "instance":
      return `i:${target.instanceId}`;
    case "part":
      return `p:${target.partId}`;
  }
}
