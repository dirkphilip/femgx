import {
  interactionTargetFromHit,
  type ElementBlockId,
  type ElementId,
  type BodyId,
  type InteractionGranularity,
  type InteractionTarget,
  type PickHit,
} from "../../../src/index";

/** The user-selectable workbench interaction granularities. */
export type SelectionGranularity = Extract<
  InteractionGranularity,
  "element" | "face" | "node" | "edge"
>;

/** A stable selection identity at any supported granularity. */
export type SelectTarget = Exclude<InteractionTarget, { readonly kind: "body" }> & {
  readonly bodyId?: BodyId;
  readonly blockId?: ElementBlockId;
  /** The exact element owning a node pick, retained for context actions. */
  readonly elementId?: ElementId;
};

/** A selection target resolved to an authored element block occurrence. */
export type BlockSelectTarget = Extract<SelectTarget, { readonly kind: "block" }>;

/**
 * Maps a GPU pick target to the active selection granularity. Shift promotes
 * to the owning element and Alt to the instance; Control/Meta remain additive
 * selection modifiers and do not change the target granularity. Shift keeps an
 * authored edge target because a shared edge has no single owning element.
 */
export function selectTarget(
  hit: PickHit,
  granularity: SelectionGranularity,
  modifiers: {
    readonly shiftKey: boolean;
    readonly altKey: boolean;
    readonly ctrlKey: boolean;
    readonly metaKey: boolean;
  },
): SelectTarget | undefined {
  return mapTarget(
    hit,
    modifiers.altKey
      ? "instance"
      : modifiers.shiftKey && granularity !== "edge"
        ? "element"
        : granularity,
    modifiers,
  );
}

/** Maps a context-menu hit at its physical granularity, independent of the toolbar. */
export function exactTarget(
  hit: PickHit,
  modifiers: Parameters<typeof selectTarget>[2],
): SelectTarget | undefined {
  const granularity: InteractionGranularity = modifiers.altKey ? "instance" : hit.kind;
  return mapTarget(hit, granularity, modifiers);
}

function mapTarget(
  hit: PickHit,
  granularity: InteractionGranularity,
  modifiers: Parameters<typeof selectTarget>[2],
): SelectTarget | undefined {
  const target = interactionTargetFromHit(hit, granularity);
  if (target === undefined || target.kind === "body") return undefined;
  const selectedTarget: SelectTarget = {
    ...target,
    ...(target.kind === "element" || target.kind === "face" || target.kind === "node"
      ? optionalBodyId("bodyId" in hit ? hit.bodyId : undefined)
      : {}),
    ...(target.kind === "element" || target.kind === "face" || target.kind === "node"
      ? optionalBlockId("blockId" in hit ? hit.blockId : undefined)
      : {}),
    ...(target.kind === "node"
      ? optionalElementId("elementId" in hit ? hit.elementId : undefined)
      : {}),
  };
  return modifiers.shiftKey && !modifiers.altKey && selectedTarget.kind !== "edge"
    ? elementTarget(selectedTarget)
    : selectedTarget;
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

function optionalBlockId(
  blockId: ElementBlockId | undefined,
): { readonly blockId: ElementBlockId } | Record<never, never> {
  return blockId === undefined ? {} : { blockId };
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
    case "block":
      return target;
    case "instance":
    case "part":
    case "edge":
      return undefined;
  }
}

/** Returns the authored block owning a physical target, when the pick carries one. */
export function elementBlockTarget(target: SelectTarget): BlockSelectTarget | undefined {
  if (target.kind === "block") return target;
  if (
    (target.kind === "element" || target.kind === "face" || target.kind === "node") &&
    target.blockId !== undefined
  ) {
    return { kind: "block", instanceId: target.instanceId, blockId: target.blockId };
  }
  return undefined;
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
    case "block":
      return `b:${target.instanceId}:${target.blockId}`;
    case "instance":
      return `i:${target.instanceId}`;
    case "part":
      return `p:${target.partId}`;
    case "edge":
      return `ed:${target.instanceId}:${target.key}`;
  }
}
