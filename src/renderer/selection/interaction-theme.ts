import type { InteractionStateData } from "../../interaction/state";

const THEME_KEYS = [
  "highlighted",
  "selected",
] as const satisfies readonly (keyof InteractionStateData["theme"])[];

/** Returns whether the interaction theme styles are unchanged. */
export function themesEqual(
  previous: InteractionStateData["theme"],
  next: InteractionStateData["theme"],
): boolean {
  return THEME_KEYS.every((key) => primitiveStylesEqual(previous[key], next[key]));
}

function primitiveStylesEqual(
  previous: InteractionStateData["theme"][keyof InteractionStateData["theme"]],
  next: InteractionStateData["theme"][keyof InteractionStateData["theme"]],
): boolean {
  return (
    previous.emissive === next.emissive &&
    previous.opacity === next.opacity &&
    previous.color?.r === next.color?.r &&
    previous.color?.g === next.color?.g &&
    previous.color?.b === next.color?.b &&
    previous.color?.a === next.color?.a
  );
}
