import type { FaceIdRef, ElementFace } from "../elements/faces";
import type { Element } from "../elements/element";
import type { ElementModel } from "../elements/model";
import type { ElementFamily } from "../elements/shapes";
import { computeBounds, type Body, type Geometry, type Part } from "./part";
import type { PartId } from "../scene/types";
import { tessellateFace } from "./face-tessellation";
import {
  bodyAssignments,
  edgeGeometry,
  lineGeometry,
  pointGeometry,
  volumeGeometry,
} from "./element-mesh-builders";
import { elementsOf } from "./element-face-selection";
import type { Vec3 } from "./vec-math";

/**
 * Tessellates an {@link ElementModel} into reusable part geometry per render
 * mode. Quadratic elements (Tet10/Hex20/LINE3) are never silently reduced to
 * linear geometry: faces are subdivided around their mid-edge nodes and curved
 * edges are drawn through the mid-edge node (or finer quadratic interpolation).
 */

/** How an element family is drawn on the GPU. */
export type ElementRenderMode = "solid" | "surface" | "edges" | "lines" | "points";

/** Tessellation knobs for quadratic and face-subset geometry. */
export interface TessellationOptions {
  /** Line segments per quadratic edge (default `2`). */
  readonly edgeSegments?: number;
  /** Optional stable body metadata for generated geometry. */
  readonly bodies?: readonly Body[];
  /** Optional element-face identities to draw in solid/surface modes. */
  readonly faceSubset?: readonly FaceIdRef[];
}

/** Returns the render modes supported by an element family. */
export function elementRenderModes(family: ElementFamily): readonly ElementRenderMode[] {
  switch (family) {
    case "triangle":
    case "quad":
    case "tet":
    case "hex":
      return ["solid", "surface", "edges"];
    case "line":
      return ["lines"];
    case "point":
      return ["points"];
  }
}

/** Builds a reusable part for one family/mode, with computed bounds. */
export function elementPart(
  partId: PartId,
  model: ElementModel,
  family: ElementFamily,
  mode: ElementRenderMode,
  options: TessellationOptions = {},
): Part {
  const geometry = elementGeometry(model, family, mode, options);
  return { id: partId, geometry, bounds: computeBounds(geometry) };
}

/** Generates geometry for one family and validates its requested render mode. */
export function elementGeometry(
  model: ElementModel,
  family: ElementFamily,
  mode: ElementRenderMode,
  options: TessellationOptions = {},
): Geometry {
  if (!elementRenderModes(family).includes(mode)) {
    throw new Error(`Render mode ${mode} is not supported for ${family} elements`);
  }
  if (options.faceSubset !== undefined && mode !== "solid" && mode !== "surface") {
    throw new Error("faceSubset is supported only for solid and surface modes");
  }
  const elements = elementsOf(model, family);
  const segments = Math.max(1, options.edgeSegments ?? 2);
  switch (mode) {
    case "solid":
    case "surface":
      return volumeGeometry({
        model,
        elements,
        bodies: options.bodies,
        faceSubset: options.faceSubset,
        includeShapes: false,
        family,
      });
    case "edges":
      return edgeGeometry(model, elements, segments);
    case "lines": {
      const bodyIds = bodyAssignments(model.elements, options.bodies);
      return lineGeometry(model, elements, segments, bodyIds, options.bodies);
    }
    case "points": {
      const bodyIds = bodyAssignments(model.elements, options.bodies);
      return pointGeometry(model, elements, bodyIds, options.bodies);
    }
  }
}

/** Tessellates one element face into outward-facing model-space triangles. */
export function faceTriangles(
  model: ElementModel,
  element: Element,
  face: ElementFace,
): ReadonlyArray<readonly [Vec3, Vec3, Vec3]> {
  return tessellateFace(model, element, face).map(
    (triangle) => [triangle[0].point, triangle[1].point, triangle[2].point] as const,
  );
}
