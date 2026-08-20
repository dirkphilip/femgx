import { createElement } from "../../../src/elements/element";

import { createElementModel, type ElementModel } from "../../../src/elements/model";

import { ElementShape } from "../../../src/elements/shapes";

import { createPartFromElementModel } from "../../../src/geometry/element-model-part";

import {
  createPart,
  validatePickIds,
  type Geometry,
  type GeometryInput,
  type TriangleGeometryInput,
  type Part,
  type TriangleGeometry,
} from "../../../src/geometry/part";

import { identityMatrix, type Mat4 } from "../../../src/math/mat4";

import {
  geometryAdjacency,
  resolveEdgePickHit,
  resolvePick,
  resolvePickHit,
  type PickContext,
  type ResolvedPickIds,
} from "../../../src/picking/pick";

import type { PartOccurrence } from "../../../src/scene/types";

import type { PickHit } from "../../../src/picking/types";

import { interactionTargetFromHit } from "../../../src/interaction/targets";

export const TET_NODES: readonly number[] = [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1];

/** Shared core test helper. */
export function tetModel(): ElementModel {
  return createElementModel(TET_NODES, [createElement(1, ElementShape.Tet4, [0, 1, 2, 3])]);
}

/** Shared core test helper. */
export function partWithGeometry(geometry: GeometryInput): Part {
  const elementId =
    (geometry.primitive === "triangles" ? geometry.faces?.[0]?.elementId : undefined) ??
    geometry.edges?.[0]?.incidentElementIds[0];
  return createPart(1, {
    geometries: [geometry],
    ...(elementId === undefined
      ? {}
      : {
          elements: [
            {
              id: elementId,
              primitiveRanges: [
                {
                  primitive: geometry.primitive,
                  primitiveStart: 0,
                  primitiveCount:
                    geometry.primitive === "triangles"
                      ? geometry.indices.length / 3
                      : geometry.primitive === "lines"
                        ? geometry.indices.length / 2
                        : geometry.indices.length,
                },
              ],
            },
          ],
          nodePositions: new Float32Array(TET_NODES),
        }),
  });
}

/** Shared core test helper. */
export function instanceAt(
  index: number,
  partId = 1,
  transform: Mat4 = identityMatrix(),
): PartOccurrence {
  return { partOccurrenceId: `1/${index}`, partId, worldTransform: transform };
}

/** Shared core test helper. */
export function ids(partial: Partial<ResolvedPickIds>): ResolvedPickIds {
  return { instancePickId: 0, elementPickId: 0, facePickId: 0, nodePickId: 0, ...partial };
}

/** Shared core test helper. */
export function triangleGeometry(model: ElementModel): TriangleGeometry {
  const part = createPartFromElementModel(1, model);
  if (part.geometries[0]?.primitive !== "triangles") throw new Error("expected triangle geometry");
  return part.geometries[0];
}

export const geometry = triangleGeometry(tetModel());

export const part = createPartFromElementModel(1, tetModel());

export const context: PickContext = { instances: [instanceAt(0)], parts: new Map([[1, part]]) };

export const shared = (): ElementModel =>
  createElementModel(
    [...TET_NODES, 0, 0, -1],
    [
      createElement(1, ElementShape.Tet4, [0, 1, 2, 3]),
      createElement(2, ElementShape.Tet4, [0, 1, 2, 4]),
    ],
  );

export const hit: PickHit = {
  kind: "face",
  partId: 4,
  partOccurrenceId: "1/2",
  elementId: 7,
  bodyId: 9,
  faceIndex: 1,
  key: "0,1,2",
  nodeIds: [0, 1, 2],
  neighborElementIds: [8],
  worldPosition: [2, 3, 4],
  normal: [0, 0, 1],
};

export {
  createElement,
  createElementModel,
  type ElementModel,
  ElementShape,
  createPartFromElementModel,
  createPart,
  validatePickIds,
  type Geometry,
  type GeometryInput,
  type TriangleGeometryInput,
  type Part,
  type TriangleGeometry,
  identityMatrix,
  type Mat4,
  geometryAdjacency,
  resolveEdgePickHit,
  resolvePick,
  resolvePickHit,
  type PickContext,
  type ResolvedPickIds,
  type PartOccurrence,
  type PickHit,
  interactionTargetFromHit,
};
