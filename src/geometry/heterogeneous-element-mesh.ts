import type { Element, ElementId } from "../elements/element";
import type { ElementModel } from "../elements/model";
import type { ElementShape } from "../elements/shapes";
import { computeBounds, type Geometry, type Part } from "./part";
import type { PartId } from "../scene/types";
import type { TessellationOptions } from "./element-mesh";
import {
  bodyAssignments,
  lineGeometry,
  pointGeometry,
  volumeGeometry,
} from "./element-mesh-builders";

/** Part ids assigned to the primitive groups emitted by a mixed model build. */
export interface HeterogeneousElementPartIds {
  readonly triangle?: PartId;
  readonly line?: PartId;
  readonly point?: PartId;
}

/** Explicit primitive groups emitted from one heterogeneous source model. */
export interface HeterogeneousElementPartSet {
  readonly triangle?: Part;
  readonly line?: Part;
  readonly point?: Part;
}

/** Machine-readable failure from heterogeneous element classification/building. */
export type HeterogeneousElementErrorCode =
  "duplicate-element-id" | "unsupported-shape" | "missing-part-id" | "duplicate-part-id";

/** Typed validation error for a mixed element build. */
export class HeterogeneousElementError extends Error {
  readonly code: HeterogeneousElementErrorCode;
  readonly elementId: ElementId | undefined;
  readonly shape: ElementShape | undefined;

  constructor(
    code: HeterogeneousElementErrorCode,
    message: string,
    details: { readonly elementId?: ElementId; readonly shape?: ElementShape } = {},
  ) {
    super(message);
    this.name = "HeterogeneousElementError";
    this.code = code;
    this.elementId = details.elementId;
    this.shape = details.shape;
  }
}

interface ElementGroups {
  readonly triangle: readonly Element[];
  readonly line: readonly Element[];
  readonly point: readonly Element[];
}

/**
 * Builds all render-compatible primitive groups from one model scan. Triangle,
 * quad, Tet4, and Hex8 share one triangle part; lines and points use explicit
 * primitive parts because WebGPU cannot mix their topologies in one draw.
 */
export function heterogeneousElementParts(
  partIds: HeterogeneousElementPartIds,
  model: ElementModel,
  options: TessellationOptions = {},
): HeterogeneousElementPartSet {
  const groups = classifyElements(model);
  validatePartIds(partIds, groups);
  const bodyIds = bodyAssignments(model.elements, options.bodies);
  return {
    ...(groups.triangle.length === 0
      ? {}
      : {
          triangle: buildPart(
            partIds.triangle as PartId,
            volumeGeometry({
              model,
              elements: groups.triangle,
              bodies: options.bodies,
              faceSubset: options.faceSubset,
              includeShapes: true,
              family: "heterogeneous",
              assignedBodies: bodyIds,
            }),
          ),
        }),
    ...(groups.line.length === 0
      ? {}
      : {
          line: buildPart(
            partIds.line as PartId,
            lineGeometry(model, groups.line, 1, bodyIds, options.bodies),
          ),
        }),
    ...(groups.point.length === 0
      ? {}
      : {
          point: buildPart(
            partIds.point as PartId,
            pointGeometry(model, groups.point, bodyIds, options.bodies),
          ),
        }),
  };
}

function buildPart(partId: PartId, geometry: Geometry): Part {
  return { id: partId, geometry, bounds: computeBounds(geometry) };
}

function classifyElements(model: ElementModel): ElementGroups {
  const triangle: Element[] = [];
  const line: Element[] = [];
  const point: Element[] = [];
  const seen = new Set<ElementId>();
  for (const element of model.elements) {
    if (seen.has(element.id)) {
      throw new HeterogeneousElementError(
        "duplicate-element-id",
        `Heterogeneous model repeats element id ${element.id}`,
        { elementId: element.id, shape: element.shape },
      );
    }
    seen.add(element.id);
    const group = supportedGroup(element.shape);
    if (group === "triangle") triangle.push(element);
    else if (group === "line") line.push(element);
    else if (group === "point") point.push(element);
    else {
      throw new HeterogeneousElementError(
        "unsupported-shape",
        `Element ${element.id} shape ${element.shape.family} order ${element.shape.order} is deferred in heterogeneousElementParts; use a typed elementPart build instead`,
        { elementId: element.id, shape: element.shape },
      );
    }
  }
  return { triangle, line, point };
}

function supportedGroup(shape: ElementShape): "triangle" | "line" | "point" | undefined {
  if (shape.family === "point" && shape.order === 0) return "point";
  if (shape.family === "line" && shape.order === 1) return "line";
  if (
    (shape.family === "triangle" ||
      shape.family === "quad" ||
      shape.family === "tet" ||
      shape.family === "hex") &&
    shape.order === 1
  ) {
    return "triangle";
  }
  return undefined;
}

function validatePartIds(partIds: HeterogeneousElementPartIds, groups: ElementGroups): void {
  const entries: ReadonlyArray<readonly [keyof HeterogeneousElementPartIds, PartId | undefined]> = [
    ["triangle", partIds.triangle],
    ["line", partIds.line],
    ["point", partIds.point],
  ];
  const seen = new Set<PartId>();
  for (const [group, partId] of entries) {
    if (partId !== undefined) {
      if (seen.has(partId)) {
        throw new HeterogeneousElementError(
          "duplicate-part-id",
          `Heterogeneous part id ${partId} is assigned to more than one primitive group`,
        );
      }
      seen.add(partId);
    }
    const count = groups[group].length;
    if (count > 0 && partId === undefined) {
      throw new HeterogeneousElementError(
        "missing-part-id",
        `Heterogeneous ${group} elements require a ${group} part id`,
      );
    }
  }
}
