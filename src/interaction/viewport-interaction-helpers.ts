import type { InteractionGranularity } from "../picking/types";
import type { BoxSelectionEvent } from "./box-selection";
import {
  clearSelection,
  isTargetSelected,
  setTargetSelected,
  setTargetsSelected,
  setTargetHovered,
} from "./targets";
import type { InteractionState } from "./interaction";
import type { InteractionTarget } from "./target-types";
import type {
  ViewportInteractionBoxEvent,
  ViewportInteractionModifiers,
} from "./viewport-interaction-types";

/** Normalizes modifier state for point and box interaction callbacks. */
export function modifiersOf(event: {
  readonly shiftKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
}): ViewportInteractionModifiers {
  return {
    shift: event.shiftKey,
    control: event.ctrlKey,
    alt: event.altKey,
    meta: event.metaKey,
  };
}

/** Rejects host point results whose identity granularity does not match the request. */
export function assertTarget(
  target: InteractionTarget | undefined,
  granularity: InteractionGranularity,
): void {
  if (target !== undefined && target.kind !== granularity) {
    throw new TypeError(
      `Viewport interaction resolver returned ${target.kind} target; expected ${granularity} target`,
    );
  }
}

/** Narrows a box lifecycle event to the completed query handoff. */
export function isCompletedBoxEvent(
  event: BoxSelectionEvent,
): event is ViewportInteractionBoxEvent {
  return event.type === "complete";
}

/** Removes duplicate target identities before Control/Meta box append. */
export function uniqueTargets(targets: readonly InteractionTarget[]): InteractionTarget[] {
  const seen = new Set<string>();
  const unique: InteractionTarget[] = [];
  for (const target of targets) {
    const key = targetKey(target);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(target);
  }
  return unique;
}

/** Applies the default replacement or modifier-toggle click policy. */
export function clickInteraction(
  current: InteractionState,
  target: InteractionTarget | undefined,
  modifiers: ViewportInteractionModifiers,
): InteractionState {
  const withoutHover = setTargetHovered(current, undefined);
  if (modifiers.control || modifiers.meta) {
    if (target === undefined) return withoutHover;
    return setTargetSelected(withoutHover, target, !isTargetSelected(current, target));
  }
  return setTargetsSelected(
    clearSelection(withoutHover),
    target === undefined ? [] : [target],
    true,
  );
}

/** Applies the default replacement or modifier-append box policy. */
export function boxInteraction(
  current: InteractionState,
  targets: readonly InteractionTarget[],
  modifiers: { readonly control: boolean; readonly meta: boolean },
): InteractionState {
  const withoutHover = setTargetHovered(current, undefined);
  if (!modifiers.control && !modifiers.meta) {
    return setTargetsSelected(clearSelection(withoutHover), targets, true);
  }
  return setTargetsSelected(withoutHover, uniqueTargets(targets), true);
}

function targetKey(target: InteractionTarget): string {
  switch (target.kind) {
    case "part":
      return `part:${target.partId}`;
    case "partOccurrence":
      return `instance:${target.partOccurrenceId}`;
    case "body":
      return `body:${target.partOccurrenceId}:${target.bodyId}`;
    case "element":
      return `element:${target.partOccurrenceId}:${target.elementId}`;
    case "face":
      return `face:${target.partOccurrenceId}:${target.elementId}:${target.faceIndex}`;
    case "node":
      return `node:${target.partOccurrenceId}:${target.nodeId}`;
    case "edge":
      return `edge:${target.partOccurrenceId}:${target.key}`;
  }
}
