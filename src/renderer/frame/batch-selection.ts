import type { Geometry } from "../../geometry/part";
import type { DrawIntent } from "./draw-admission";
import type { DrawCall, DrawCallContext, SelectionDrawRange } from "../resources/draw-resources";

/** Identifies a triangle-only range union that can use a compact replay. */
export function canReplaySelection(
  geometries: readonly (Geometry | undefined)[],
  ranges: readonly SelectionDrawRange[] | undefined,
): ranges is readonly SelectionDrawRange[] {
  return (
    geometries.length === 1 &&
    geometries[0]?.primitive === "triangles" &&
    geometries[0].faceSubset !== undefined &&
    ranges !== undefined &&
    ranges.every((range) => range.primitive === "triangles")
  );
}

/** Excludes supplemental skin ranges when their matching subset pass is inactive. */
export function inactiveSelectionSkinRange(
  call: DrawCall,
  intent: DrawIntent,
  context: DrawCallContext,
  range: SelectionDrawRange | undefined,
): boolean {
  return (
    range !== undefined &&
    call.surfaceSubset === true &&
    (intent.kind !== "surface" || intent.surfaceSubset !== true || !context.usesExteriorFaceSubsets)
  );
}

/** Selects the retained exterior subset only for compatible surface passes. */
export function usesFaceSubset(options: {
  readonly intent: DrawIntent;
  readonly geometry: Geometry | undefined;
  readonly nodes: boolean;
  readonly range: SelectionDrawRange | undefined;
  readonly exteriorSubsets: boolean;
  readonly callSurfaceSubset: boolean | undefined;
}): boolean {
  const { intent, geometry, nodes, range, exteriorSubsets, callSurfaceSubset } = options;
  const useExteriorSubset = callSurfaceSubset ?? exteriorSubsets;
  const selectedVisibleSubset =
    intent.kind === "surface" &&
    intent.pass === "selection-visible" &&
    intent.surfaceSubset === true &&
    useExteriorSubset &&
    exteriorSubsets;
  const selectedHiddenSubset =
    intent.kind === "surface" &&
    intent.pass === "selection-hidden" &&
    intent.surfaceSubset === true &&
    callSurfaceSubset === true &&
    exteriorSubsets;
  const ordinarySubset =
    intent.kind === "surface" &&
    !intent.pass.startsWith("selection-") &&
    useExteriorSubset &&
    intent.surfaceSubset !== false;
  return (
    !nodes &&
    range === undefined &&
    (selectedVisibleSubset || selectedHiddenSubset || ordinarySubset) &&
    geometry?.primitive === "triangles" &&
    geometry.faceSubset !== undefined
  );
}
