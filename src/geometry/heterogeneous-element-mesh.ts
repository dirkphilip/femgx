import type { FaceIdRef } from "../elements/faces";
import type { Element, ElementId } from "../elements/element";
import { elementModelMembership, type ElementModel } from "../elements/model";
import { topologyFor } from "../elements/shapes";
import {
  createPart,
  type LineGeometry,
  type Part,
  type PointGeometry,
  type TriangleGeometry,
} from "./part";
import type { PartId } from "./part";
import {
  bodiesForElements,
  lineGeometry,
  pointGeometry,
  volumeGeometry,
} from "./element-mesh-builders";

/**
 * Tessellation options shared by the single mixed-model compiler.
 * @category Scene and geometry
 */
export interface TessellationOptions {
  /** Optional stable element-face identities to draw in the triangle group. */
  readonly faceSubset?: readonly FaceIdRef[];
}

interface ElementGroups {
  readonly triangle: readonly Element[];
  readonly line: readonly Element[];
  readonly point: readonly Element[];
}

/**
 * Builds one semantic part from a heterogeneous element model. Geometry remains
 * homogeneous inside each leaf, while element ownership is shared at part level.
 * @category Scene and geometry
 */
export function elementPart(
  partId: PartId,
  model: ElementModel,
  options: TessellationOptions = {},
): Part {
  const groups = classifyElements(model);
  const membership = elementModelMembership(model);
  const geometries: (TriangleGeometry | LineGeometry | PointGeometry)[] = [];
  if (groups.triangle.length > 0) {
    geometries.push(
      volumeGeometry({
        model,
        elements: groups.triangle,
        faceSubset: options.faceSubset,
        assignedBodies: membership.bodyByElement,
        assignedBlocks: membership.blockByElement,
      }),
    );
  }
  if (groups.line.length > 0) {
    geometries.push(
      lineGeometry(model, groups.line, membership.bodyByElement, membership.blockByElement),
    );
  }
  if (groups.point.length > 0) {
    geometries.push(
      pointGeometry(model, groups.point, membership.bodyByElement, membership.blockByElement),
    );
  }
  const part = createPart(partId, geometries);
  return {
    ...part,
    nodePositions: new Float32Array(model.nodes),
    bodies: bodiesForElements(model, model.elements, membership.bodyByElement) ?? [],
  };
}

function classifyElements(model: ElementModel): ElementGroups {
  const triangle: Element[] = [];
  const line: Element[] = [];
  const point: Element[] = [];
  const seen = new Set<ElementId>();
  for (const element of model.elements) {
    if (seen.has(element.id)) {
      throw new Error(`Element model repeats element id ${element.id}`);
    }
    seen.add(element.id);
    const group = supportedGroup(element);
    if (group === "triangle") triangle.push(element);
    else if (group === "line") line.push(element);
    else if (group === "point") point.push(element);
    else {
      throw new Error(
        `Element ${element.id} shape ${element.shape.family} order ${element.shape.order} is not supported by elementPart`,
      );
    }
  }
  return { triangle, line, point };
}

function supportedGroup(element: Element): "triangle" | "line" | "point" | undefined {
  try {
    topologyFor(element.shape);
  } catch {
    return undefined;
  }
  switch (element.shape.family) {
    case "point":
      return "point";
    case "line":
      return "line";
    case "triangle":
    case "quad":
    case "tet":
    case "wedge":
    case "pyramid":
    case "hex":
      return "triangle";
  }
}
