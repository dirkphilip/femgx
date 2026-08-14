import { validateElements, validatePickIds } from "./part-validation";
import { validatePartId } from "./id-validation";
import type { Bounds, Geometry } from "./types";

export type {
  Bounds,
  ElementTessellation,
  FaceSubset,
  FaceTessellation,
  GeometryBody,
  GeometryElementBlock,
  Geometry,
  LineGeometry,
  LinearGeometry,
  PointGeometry,
  Primitive,
  TriangleGeometry,
} from "./types";
export type { BodyId, ElementBlockId } from "../elements/model";

/**
 * A globally stable identifier for a reusable part within a scene.
 * @category Scene and geometry
 */
export type PartId = number;

export { MAX_PART_ID, validatePartId } from "./id-validation";

/**
 * Reusable, immutable drawable geometry. Parts never own world transforms;
 * they are shared and instanced many times by assemblies.
 * @category Start here
 */
export interface Part {
  readonly [partBrand]: true;
  readonly id: PartId;
  readonly geometry: Geometry;
  readonly bounds: Bounds;
}

const partBrand: unique symbol = Symbol("Part");

/**
 * Validates and constructs one immutable part boundary. `createPart` retains
 * the supplied typed arrays without defensive copies and takes ownership of
 * them; callers must not mutate or reuse those arrays after this call. Bounds
 * are always derived from the supplied geometry, including the finite zero box
 * for an empty part, so callers cannot provide stale bounds.
 * @category Start here
 */
export function createPart<T extends Geometry>(
  id: PartId,
  geometry: T,
): Part & { readonly geometry: T } {
  validatePartId(id);
  validateGeometryArrays(geometry);
  validateElements(geometry);
  validatePickIds(geometry);
  return {
    [partBrand]: true,
    id,
    geometry,
    bounds: finitePartBounds(geometry),
  };
}

/** Computes the bounding box of a geometry's positions. */
export function computeBounds(geometry: Geometry): Bounds {
  return computePositionsBounds(geometry.positions);
}

/** Returns all eight corners of a bounds box in deterministic order. */
export function boundsCorners(bounds: Bounds): ReadonlyArray<readonly [number, number, number]> {
  return [
    [bounds.minX, bounds.minY, bounds.minZ],
    [bounds.minX, bounds.minY, bounds.maxZ],
    [bounds.minX, bounds.maxY, bounds.minZ],
    [bounds.minX, bounds.maxY, bounds.maxZ],
    [bounds.maxX, bounds.minY, bounds.minZ],
    [bounds.maxX, bounds.minY, bounds.maxZ],
    [bounds.maxX, bounds.maxY, bounds.minZ],
    [bounds.maxX, bounds.maxY, bounds.maxZ],
  ];
}

const EMPTY_PART_BOUNDS: Bounds = {
  minX: 0,
  minY: 0,
  minZ: 0,
  maxX: 0,
  maxY: 0,
  maxZ: 0,
};

function finitePartBounds(geometry: Geometry): Bounds {
  return geometry.positions.length === 0 ? EMPTY_PART_BOUNDS : computeBounds(geometry);
}

function validateGeometryArrays(geometry: Geometry): void {
  if (geometry.positions.length % 3 !== 0) {
    throw new Error("Geometry positions length must be a multiple of 3");
  }
  const vertexCount = geometry.positions.length / 3;
  for (const position of geometry.positions) {
    if (!Number.isFinite(position)) throw new Error("Geometry positions must be finite");
  }
  if (geometry.nodePositions !== undefined) {
    if (geometry.nodePositions.length % 3 !== 0) {
      throw new Error("Geometry nodePositions length must be a multiple of 3");
    }
    for (const position of geometry.nodePositions) {
      if (!Number.isFinite(position)) throw new Error("Geometry nodePositions must be finite");
    }
  }
  const indicesPerPrimitive =
    geometry.primitive === "triangles" ? 3 : geometry.primitive === "lines" ? 2 : 1;
  if (geometry.indices.length % indicesPerPrimitive !== 0) {
    throw new Error(
      `Geometry index count must be a multiple of ${indicesPerPrimitive} for ${geometry.primitive}`,
    );
  }
  for (const index of geometry.indices) {
    if (index >= vertexCount) throw new Error(`Geometry index ${index} is outside positions`);
  }
}

/** Returns whether every component of a bounding box is finite. */
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

/**
 * Computes the bounding box of raw positions in single or double precision.
 */
export function computePositionsBounds(positions: Float32Array | Float64Array): Bounds {
  const mins = { minX: Infinity, minY: Infinity, minZ: Infinity };
  const maxs = { maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity };
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i] ?? 0;
    const y = positions[i + 1] ?? 0;
    const z = positions[i + 2] ?? 0;
    if (x < mins.minX) mins.minX = x;
    if (y < mins.minY) mins.minY = y;
    if (z < mins.minZ) mins.minZ = z;
    if (x > maxs.maxX) maxs.maxX = x;
    if (y > maxs.maxY) maxs.maxY = y;
    if (z > maxs.maxZ) maxs.maxZ = z;
  }
  return { ...mins, ...maxs };
}

export {
  bodyIdForElement,
  GeometryValidationError,
  logicalPrimitiveCount,
  primitiveRangeForElement,
  validateBodies,
  validateElements,
  validateFaceSubset,
  faceForPrimitive,
  validatePickIds,
} from "./part-validation";
export type { GeometryValidationCode } from "./part-validation";
