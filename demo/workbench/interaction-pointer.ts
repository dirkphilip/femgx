import type { PickHit } from "../../src/index";

export interface HoverPick {
  readonly clientX: number;
  readonly clientY: number;
  readonly hit: PickHit;
}

export interface PointerModifiers {
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
}

/** Copies the modifier state present when a pointer gesture begins. */
export function modifiersOf(event: PointerModifiers): PointerModifiers {
  return {
    shiftKey: event.shiftKey,
    altKey: event.altKey,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
  };
}

/** Retains a modifier that was held for pointer-down but omitted from click. */
export function mergeModifiers(
  event: PointerModifiers,
  down: PointerModifiers | undefined,
): PointerModifiers {
  return {
    shiftKey: event.shiftKey || down?.shiftKey === true,
    altKey: event.altKey || down?.altKey === true,
    ctrlKey: event.ctrlKey || down?.ctrlKey === true,
    metaKey: event.metaKey || down?.metaKey === true,
  };
}
