import type { Bounds } from "../geometry/part";

/**
 * True when every component of an axis-aligned bounds is finite. Degenerate
 * (non-finite) bounds make unioning and sphere tests meaningless: a single NaN
 * component propagates through `Math.min`/`Math.max` (`Math.min(4.5, NaN) ===
 * NaN`), so one corrupt bounds would poison a whole model's bounds union or
 * local-rebase origin. Streaming therefore skips such bounds when aggregating
 * and treats chunks/cells carrying them as always visible rather than silently
 * culled.
 */
export function isFiniteBounds(bounds: Bounds): boolean {
  return (
    Number.isFinite(bounds.minX) &&
    Number.isFinite(bounds.minY) &&
    Number.isFinite(bounds.minZ) &&
    Number.isFinite(bounds.maxX) &&
    Number.isFinite(bounds.maxY) &&
    Number.isFinite(bounds.maxZ)
  );
}
