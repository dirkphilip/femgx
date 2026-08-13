import {
  bodyIdForElement,
  faceForPrimitive,
  isFiniteBounds,
  logicalPrimitiveCount,
  primitiveRangeForElement,
  type Bounds,
  type Part,
} from "../geometry/part";
import type { InteractionTarget } from "../interaction/target-types";
import type { DeformationState } from "../results/deform";

type EntityTarget = Extract<InteractionTarget, { kind: "body" | "element" | "face" | "node" }>;

/** Mutable bounds accumulator shared by viewport bounds calculations. */
export interface MutableBounds {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

/** Returns the finite bounds of the geometry that the renderer displays. */
export function displayedPartBounds(
  part: Part,
  deformation: DeformationState | undefined,
): Bounds | undefined {
  return primitiveBounds(part, displayedPrimitive(part), deformation);
}

/** Returns the finite bounds of one exact displayed entity within a part. */
export function selectedGeometryBounds(
  part: Part,
  target: EntityTarget,
  deformation: DeformationState | undefined,
): Bounds | undefined {
  switch (target.kind) {
    case "body":
      return bodyBounds(part, target.bodyId, deformation);
    case "element":
      return elementBounds(part, target.elementId, deformation);
    case "face":
      return faceBounds(part, target, deformation);
    case "node":
      return nodeBounds(part, target.nodeId, deformation);
  }
}

/** Adds deterministic scene-scale padding only to degenerate selected axes. */
export function padDegenerateBounds(bounds: Bounds, sceneBounds: Bounds): Bounds {
  const padding = Math.max(boundsScale(sceneBounds) * 1e-3, Number.MIN_VALUE);
  return {
    minX: bounds.minX === bounds.maxX ? bounds.minX - padding : bounds.minX,
    minY: bounds.minY === bounds.maxY ? bounds.minY - padding : bounds.minY,
    minZ: bounds.minZ === bounds.maxZ ? bounds.minZ - padding : bounds.minZ,
    maxX: bounds.maxX === bounds.minX ? bounds.maxX + padding : bounds.maxX,
    maxY: bounds.maxY === bounds.minY ? bounds.maxY + padding : bounds.maxY,
    maxZ: bounds.maxZ === bounds.minZ ? bounds.maxZ + padding : bounds.maxZ,
  };
}

function bodyBounds(
  part: Part,
  bodyId: number,
  deformation: DeformationState | undefined,
): Bounds | undefined {
  const ranges = (part.geometry.elements ?? [])
    .filter((element) => bodyIdForElement(part.geometry, element.id) === bodyId)
    .map(primitiveRangeForElement);
  return primitiveBounds(
    part,
    (primitive) =>
      ranges.some((range) => primitive >= range.start && primitive < range.start + range.count),
    deformation,
  );
}

function elementBounds(
  part: Part,
  elementId: number,
  deformation: DeformationState | undefined,
): Bounds | undefined {
  const element = part.geometry.elements?.find((candidate) => candidate.id === elementId);
  if (element === undefined) return undefined;
  const range = primitiveRangeForElement(element);
  return primitiveBounds(
    part,
    (primitive) => primitive >= range.start && primitive < range.start + range.count,
    deformation,
  );
}

function faceBounds(
  part: Part,
  target: Extract<InteractionTarget, { kind: "face" }>,
  deformation: DeformationState | undefined,
): Bounds | undefined {
  if (part.geometry.primitive !== "triangles") return undefined;
  const face = part.geometry.faces?.find(
    (candidate) =>
      candidate.elementId === target.elementId && candidate.faceIndex === target.faceIndex,
  );
  if (face === undefined) return undefined;
  return primitiveBounds(
    part,
    (primitive) =>
      primitive >= face.primitiveStart && primitive < face.primitiveStart + face.primitiveCount,
    deformation,
  );
}

function nodeBounds(
  part: Part,
  nodeId: number,
  deformation: DeformationState | undefined,
): Bounds | undefined {
  const nodePickId = nodeId + 1;
  const nodePickIds = part.geometry.nodePickIds;
  if (nodePickIds === undefined || !nodePickIds.includes(nodePickId)) return undefined;
  const nodePositions = part.geometry.nodePositions;
  if (nodePositions !== undefined) {
    const offset = nodeId * 3;
    const point = nodePositions.subarray(offset, offset + 3);
    if (point.length === 3) return pointBounds(displacedNode(part.id, nodeId, point, deformation));
  }
  return primitiveBounds(
    part,
    (primitive) => primitiveNodePickIds(part, primitive).includes(nodePickId),
    deformation,
  );
}

function primitiveBounds(
  part: Part,
  includePrimitive: (primitive: number) => boolean,
  deformation: DeformationState | undefined,
): Bounds | undefined {
  const bounds = emptyBounds();
  const geometry = part.geometry;
  const isDisplayed = displayedPrimitive(part);
  const verticesPerPrimitive =
    geometry.primitive === "triangles" ? 3 : geometry.primitive === "lines" ? 2 : 1;
  const primitiveCount = logicalPrimitiveCount(geometry);
  for (let primitive = 0; primitive < primitiveCount; primitive += 1) {
    if (!isDisplayed(primitive) || !includePrimitive(primitive)) continue;
    for (let corner = 0; corner < verticesPerPrimitive; corner += 1) {
      const index = geometry.indices[primitive * verticesPerPrimitive + corner];
      if (index !== undefined) include(bounds, displacedVertex(part, index, deformation));
    }
  }
  return isFiniteBounds(bounds) ? bounds : undefined;
}

function displayedPrimitive(part: Part): (primitive: number) => boolean {
  const geometry = part.geometry;
  if (geometry.primitive !== "triangles" || geometry.faceSubset === undefined) return () => true;
  return (primitive) => {
    const face = faceForPrimitive(geometry, primitive);
    return (
      face !== undefined &&
      geometry.faceSubset?.faceIds.some(
        (ref) => ref.elementId === face.elementId && ref.faceIndex === face.faceIndex,
      ) === true
    );
  };
}

function primitiveNodePickIds(part: Part, primitive: number): readonly number[] {
  const geometry = part.geometry;
  const verticesPerPrimitive =
    geometry.primitive === "triangles" ? 3 : geometry.primitive === "lines" ? 2 : 1;
  const ids: number[] = [];
  for (let corner = 0; corner < verticesPerPrimitive; corner += 1) {
    const index = geometry.indices[primitive * verticesPerPrimitive + corner];
    if (index !== undefined) ids.push(geometry.nodePickIds?.[index] ?? 0);
  }
  return ids;
}

function displacedVertex(
  part: Part,
  vertexIndex: number,
  deformation: DeformationState | undefined,
): readonly [number, number, number] {
  const offset = vertexIndex * 3;
  const positions = part.geometry.positions;
  const point: readonly [number, number, number] = [
    positions[offset] ?? 0,
    positions[offset + 1] ?? 0,
    positions[offset + 2] ?? 0,
  ];
  const nodePickId = part.geometry.nodePickIds?.[vertexIndex] ?? 0;
  return nodePickId === 0 ? point : displacedNode(part.id, nodePickId - 1, point, deformation);
}

function displacedNode(
  partId: number,
  nodeId: number,
  point: ArrayLike<number>,
  deformation: DeformationState | undefined,
): readonly [number, number, number] {
  const state = deformation;
  const values = state?.displacements.get(partId);
  if (values === undefined || state === undefined) {
    return [finiteOrZero(point[0]), finiteOrZero(point[1]), finiteOrZero(point[2])];
  }
  const offset = nodeId * 3;
  const dx = values[offset];
  const dy = values[offset + 1];
  const dz = values[offset + 2];
  return [
    finiteOrZero(point[0]) + finiteOrZero(dx) * state.scale,
    finiteOrZero(point[1]) + finiteOrZero(dy) * state.scale,
    finiteOrZero(point[2]) + finiteOrZero(dz) * state.scale,
  ];
}

function pointBounds(point: readonly [number, number, number]): Bounds {
  return {
    minX: point[0],
    minY: point[1],
    minZ: point[2],
    maxX: point[0],
    maxY: point[1],
    maxZ: point[2],
  };
}

/** Creates an empty mutable bounds accumulator. */
export function emptyBounds(): MutableBounds {
  return {
    minX: Infinity,
    minY: Infinity,
    minZ: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
    maxZ: -Infinity,
  };
}

/** Includes one point in a mutable bounds accumulator. */
export function include(bounds: MutableBounds, point: readonly [number, number, number]): void {
  bounds.minX = Math.min(bounds.minX, point[0]);
  bounds.minY = Math.min(bounds.minY, point[1]);
  bounds.minZ = Math.min(bounds.minZ, point[2]);
  bounds.maxX = Math.max(bounds.maxX, point[0]);
  bounds.maxY = Math.max(bounds.maxY, point[1]);
  bounds.maxZ = Math.max(bounds.maxZ, point[2]);
}

function boundsScale(bounds: Bounds): number {
  return Math.hypot(
    bounds.maxX - bounds.minX,
    bounds.maxY - bounds.minY,
    bounds.maxZ - bounds.minZ,
  );
}

function finiteOrZero(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) ? value : 0;
}
