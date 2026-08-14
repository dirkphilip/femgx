import type { Bounds, SectionPlane } from "../../src/index";

export type SectionAxis = "off" | "x" | "y" | "z";

/** Returns the selected model-axis bounds used by the offset slider. */
export function sectionAxisBounds(
  bounds: Bounds,
  axis: Exclude<SectionAxis, "off">,
): { readonly min: number; readonly max: number } {
  if (axis === "x") return { min: bounds.minX, max: bounds.maxX };
  if (axis === "y") return { min: bounds.minY, max: bounds.maxY };
  return { min: bounds.minZ, max: bounds.maxZ };
}

/** Maps the demo's axis/offset controls to the viewport plane convention. */
export function sectionPlaneFor(axis: SectionAxis, offset: number): SectionPlane | undefined {
  if (axis === "off") return undefined;
  const normal: [number, number, number] =
    axis === "x" ? [1, 0, 0] : axis === "y" ? [0, 1, 0] : [0, 0, 1];
  return { normal, distance: -offset };
}

/** Keeps an offset inside the complete placed-scene extent. */
export function clampSectionOffset(value: number, bounds: Bounds, axis: SectionAxis): number {
  if (axis === "off") return 0;
  const range = sectionAxisBounds(bounds, axis);
  return Math.min(range.max, Math.max(range.min, value));
}

/** Returns the midpoint used when switching to a new model axis. */
export function sectionAxisMidpoint(bounds: Bounds, axis: SectionAxis): number {
  if (axis === "off") return 0;
  const range = sectionAxisBounds(bounds, axis);
  return (range.min + range.max) / 2;
}

/** Parses the finite set of section controls exposed by the demo. */
export function parseSectionAxis(value: string): SectionAxis | undefined {
  return value === "off" || value === "x" || value === "y" || value === "z" ? value : undefined;
}
