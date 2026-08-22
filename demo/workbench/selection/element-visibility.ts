import type { ElementTessellation, PartOccurrenceId, Viewport } from "@/entries/root";

/** Returns whether an element occurrence passes both element and body visibility gates. */
export function isElementOccurrenceVisible(
  viewport: Viewport,
  partOccurrenceId: PartOccurrenceId,
  element: ElementTessellation,
): boolean {
  return viewport.visibility.isElementEffectivelyVisible({
    partOccurrenceId,
    elementId: element.id,
  });
}
