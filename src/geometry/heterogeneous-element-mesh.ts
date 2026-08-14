import type { FaceIdRef } from "../elements/faces";
import type { Element, ElementId } from "../elements/element";
import { elementModelMembership, type ElementModel } from "../elements/model";
import { topologyFor, type ElementShape } from "../elements/shapes";
import {
  createPart,
  validatePartId,
  type LineGeometry,
  type Part,
  type PointGeometry,
  type TriangleGeometry,
} from "./part";
import type { PartId } from "./part";
import { lineGeometry, pointGeometry, volumeGeometry } from "./element-mesh-builders";

/** Tessellation options shared by the single mixed-model compiler. */
export interface TessellationOptions {
  /** Optional stable element-face identities to draw in the triangle group. */
  readonly faceSubset?: readonly FaceIdRef[];
}

/** Part ids assigned to the primitive groups emitted by a mixed model build. */
export interface HeterogeneousElementPartIds {
  readonly triangle?: PartId;
  readonly line?: PartId;
  readonly point?: PartId;
}

/** Explicit primitive groups emitted from one heterogeneous source model. */
export interface HeterogeneousElementPartSet {
  readonly triangle?: Part & { readonly geometry: TriangleGeometry };
  readonly line?: Part & { readonly geometry: LineGeometry };
  readonly point?: Part & { readonly geometry: PointGeometry };
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
 * Builds all render-compatible primitive groups from one model scan. Surface
 * and volume elements share one triangle part; lines and points use explicit
 * primitive parts because WebGPU cannot mix their topologies in one draw.
 */
export function heterogeneousElementParts(
  partIds: HeterogeneousElementPartIds,
  model: ElementModel,
  options: TessellationOptions = {},
): HeterogeneousElementPartSet {
  const groups = classifyElements(model);
  validatePartIds(partIds, groups);
  const membership = elementModelMembership(model);
  return {
    ...(groups.triangle.length === 0
      ? {}
      : {
          triangle: createPart(
            partIds.triangle as PartId,
            volumeGeometry({
              model,
              elements: groups.triangle,
              faceSubset: options.faceSubset,
              assignedBodies: membership.bodyByElement,
              assignedBlocks: membership.blockByElement,
            }),
          ),
        }),
    ...(groups.line.length === 0
      ? {}
      : {
          line: createPart(
            partIds.line as PartId,
            lineGeometry(model, groups.line, membership.bodyByElement, membership.blockByElement),
          ),
        }),
    ...(groups.point.length === 0
      ? {}
      : {
          point: createPart(
            partIds.point as PartId,
            pointGeometry(model, groups.point, membership.bodyByElement, membership.blockByElement),
          ),
        }),
  };
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
    const group = supportedGroup(element);
    if (group === "triangle") triangle.push(element);
    else if (group === "line") line.push(element);
    else if (group === "point") point.push(element);
    else {
      throw new HeterogeneousElementError(
        "unsupported-shape",
        `Element ${element.id} shape ${element.shape.family} order ${element.shape.order} is not supported by heterogeneousElementParts`,
        { elementId: element.id, shape: element.shape },
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

function validatePartIds(partIds: HeterogeneousElementPartIds, groups: ElementGroups): void {
  const entries: ReadonlyArray<readonly [keyof HeterogeneousElementPartIds, PartId | undefined]> = [
    ["triangle", partIds.triangle],
    ["line", partIds.line],
    ["point", partIds.point],
  ];
  const seen = new Set<PartId>();
  for (const [group, partId] of entries) {
    if (partId !== undefined) {
      validatePartId(partId);
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
