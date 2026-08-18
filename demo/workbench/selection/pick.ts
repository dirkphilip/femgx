import { type InteractionGranularity, type PickHit } from "../../../src/entries/root";
import { interactionTargetFromHit, type InteractionTarget } from "../../../src/entries/interaction";
import type { BodyId, ElementId } from "../../../src/entries/model";

/** The user-selectable workbench interaction granularities. */
export type SelectionGranularity = Extract<
  InteractionGranularity,
  "part" | "partOccurrence" | "body" | "element" | "face" | "node" | "edge"
>;

/** A stable selection identity at any supported granularity. */
export type SelectTarget = InteractionTarget & {
  readonly bodyId?: BodyId;
  /** The exact element owning a node pick, retained for context actions. */
  readonly elementId?: ElementId;
};

/**
 * Maps a GPU pick target to the active selection granularity. Shift promotes
 * face and node targets to their owning element and Alt to the instance;
 * Control/Meta remain additive selection modifiers. Part and instance modes
 * stay at their selected scope, while authored edges have no single owner.
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
      ? "partOccurrence"
      : modifiers.shiftKey &&
          granularity !== "part" &&
          granularity !== "partOccurrence" &&
          granularity !== "edge" &&
          granularity !== "body"
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
  const granularity: InteractionGranularity = modifiers.altKey ? "partOccurrence" : hit.kind;
  return mapTarget(hit, granularity, modifiers);
}

function mapTarget(
  hit: PickHit,
  granularity: InteractionGranularity,
  modifiers: Parameters<typeof selectTarget>[2],
): SelectTarget | undefined {
  const target = interactionTargetFromHit(hit, granularity);
  if (target === undefined) return undefined;
  const selectedTarget: SelectTarget = {
    ...target,
    ...(target.kind === "element" || target.kind === "face" || target.kind === "node"
      ? optionalBodyId("bodyId" in hit ? hit.bodyId : undefined)
      : {}),
    ...(target.kind === "node"
      ? optionalElementId("elementId" in hit ? hit.elementId : undefined)
      : {}),
  };
  return modifiers.shiftKey &&
    !modifiers.altKey &&
    selectedTarget.kind !== "part" &&
    selectedTarget.kind !== "partOccurrence" &&
    selectedTarget.kind !== "edge" &&
    selectedTarget.kind !== "body"
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

/** Promotes an element-owned pick to its exact owning element identity. */
export function elementTarget(target: SelectTarget): SelectTarget | undefined {
  switch (target.kind) {
    case "node":
      return target.elementId === undefined
        ? undefined
        : {
            kind: "element",
            partOccurrenceId: target.partOccurrenceId,
            elementId: target.elementId,
          };
    case "face":
    case "element":
      return {
        kind: "element",
        partOccurrenceId: target.partOccurrenceId,
        elementId: target.elementId,
      };
    case "body":
    case "partOccurrence":
    case "part":
    case "edge":
      return undefined;
  }
}

/** Stable dataset key for a resolved pick or selection target. */
export function targetKey(target: PickHit | SelectTarget | undefined): string {
  if (target === undefined) return "";
  switch (target.kind) {
    case "body":
      return `body:${target.partOccurrenceId}:${target.bodyId}`;
    case "node":
      return `n:${target.partOccurrenceId}:${target.nodeId}`;
    case "face":
      return `f:${target.partOccurrenceId}:${target.elementId}:${target.faceIndex}`;
    case "element":
      return `e:${target.partOccurrenceId}:${target.elementId}`;
    case "partOccurrence":
      return `i:${target.partOccurrenceId}`;
    case "part":
      return `p:${target.partId}`;
    case "edge":
      return `ed:${target.partOccurrenceId}:${target.key}`;
  }
}
