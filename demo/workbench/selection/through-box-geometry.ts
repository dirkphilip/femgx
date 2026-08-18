import type {
  ElementTessellation,
  Geometry,
  Mat4,
  Part,
  Primitive,
  SectionPlane,
  Vec3,
} from "../../../src/entries/root";
import type { BoxSelectionFrustum } from "../../../src/entries/interaction";
import type { DeformationState } from "../../../src/entries/results";

const PRIMITIVE_ARITY: Record<Primitive, number> = {
  triangles: 3,
  lines: 2,
  points: 1,
};

const FRUSTUM_PLANES: readonly (keyof BoxSelectionFrustum)[] = [
  "left",
  "right",
  "top",
  "bottom",
  "near",
  "far",
];

export interface PartQueryData {
  readonly elements: readonly ElementTessellation[];
  readonly geometryByPrimitive: ReadonlyMap<Primitive, Geometry>;
  readonly elementBounds: Float64Array;
}

export type MutableVec3 = [number, number, number];

const queryDataByPart = new WeakMap<Part, PartQueryData>();
const EMPTY_ELEMENTS: readonly ElementTessellation[] = [];

/** Builds and caches the ordered geometry and local bounds used by box queries. */
export function queryData(part: Part): PartQueryData {
  const cached = queryDataByPart.get(part);
  if (cached !== undefined) return cached;
  const elements = orderedElements(part.elements ?? EMPTY_ELEMENTS);
  const geometryByPrimitive = new Map(
    part.geometries.map((geometry) => [geometry.primitive, geometry]),
  );
  const data = {
    elements,
    geometryByPrimitive,
    elementBounds: buildElementBounds(elements, geometryByPrimitive),
  };
  queryDataByPart.set(part, data);
  return data;
}

function orderedElements(elements: readonly ElementTessellation[]): readonly ElementTessellation[] {
  for (let index = 1; index < elements.length; index += 1) {
    const previous = elements[index - 1];
    const current = elements[index];
    if (previous !== undefined && current !== undefined && current.id < previous.id) {
      return [...elements].sort((left, right) => left.id - right.id);
    }
  }
  return elements;
}

function buildElementBounds(
  elements: readonly ElementTessellation[],
  geometryByPrimitive: ReadonlyMap<Primitive, Geometry>,
): Float64Array {
  const bounds = new Float64Array(elements.length * 6);
  for (let elementIndex = 0; elementIndex < elements.length; elementIndex += 1) {
    const element = elements[elementIndex];
    if (element === undefined) continue;
    const extent = elementExtent(element, geometryByPrimitive);
    const base = elementIndex * 6;
    bounds[base] = extent.minX;
    bounds[base + 1] = extent.minY;
    bounds[base + 2] = extent.minZ;
    bounds[base + 3] = extent.maxX;
    bounds[base + 4] = extent.maxY;
    bounds[base + 5] = extent.maxZ;
  }
  return bounds;
}

interface ElementExtent {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

function elementExtent(
  element: ElementTessellation,
  geometryByPrimitive: ReadonlyMap<Primitive, Geometry>,
): ElementExtent {
  const extent: ElementExtent = {
    minX: Infinity,
    minY: Infinity,
    minZ: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
    maxZ: -Infinity,
  };
  for (const range of element.primitiveRanges) {
    const geometry = geometryByPrimitive.get(range.primitive);
    if (geometry === undefined) continue;
    const arity = PRIMITIVE_ARITY[range.primitive];
    const start = range.primitiveStart * arity;
    const end = start + range.primitiveCount * arity;
    for (let offset = start; offset < end; offset += 1) {
      const vertexIndex = geometry.indices[offset];
      if (vertexIndex === undefined) continue;
      const base = vertexIndex * 3;
      const x = geometry.positions[base];
      const y = geometry.positions[base + 1];
      const z = geometry.positions[base + 2];
      if (x === undefined || y === undefined || z === undefined) continue;
      extent.minX = Math.min(extent.minX, x);
      extent.minY = Math.min(extent.minY, y);
      extent.minZ = Math.min(extent.minZ, z);
      extent.maxX = Math.max(extent.maxX, x);
      extent.maxY = Math.max(extent.maxY, y);
      extent.maxZ = Math.max(extent.maxZ, z);
    }
  }
  return extent;
}

export interface ElementQuery {
  readonly part: Part;
  readonly element: ElementTessellation;
  readonly geometryByPrimitive: ReadonlyMap<Primitive, Geometry>;
  readonly transform: Mat4;
  readonly frustum: BoxSelectionFrustum;
  readonly sectionPlane: SectionPlane | undefined;
  readonly deformation: DeformationState | undefined;
  readonly tolerance: number;
  readonly elementBounds: Float64Array;
  readonly elementIndex: number;
  readonly points: readonly MutableVec3[];
}

/** Tests one element against the exact frustum and any active section plane. */
export function elementIntersectsBox(query: ElementQuery): boolean {
  // Deformation changes the cached local bounds, so those queries keep the exact primitive path.
  if (query.deformation === undefined && !boundsMayIntersect(query)) return false;
  for (const range of query.element.primitiveRanges) {
    const geometry = query.geometryByPrimitive.get(range.primitive);
    if (geometry === undefined) continue;
    const arity = PRIMITIVE_ARITY[range.primitive];
    const start = range.primitiveStart * arity;
    const end = start + range.primitiveCount * arity;
    for (let offset = start; offset < end; offset += arity) {
      if (!writePrimitivePoints(query, geometry, offset, arity)) continue;
      if (
        primitiveIntersectsFrustum(
          query.points,
          arity,
          query.frustum,
          query.sectionPlane,
          query.tolerance,
        )
      ) {
        return true;
      }
    }
  }
  return false;
}

function boundsMayIntersect(query: ElementQuery): boolean {
  const base = query.elementIndex * 6;
  if (!isAffineTransform(query.transform)) return true;
  for (const name of FRUSTUM_PLANES) {
    if (
      maxBoundsDistance(query.elementBounds, base, query.transform, query.frustum[name]) <
      -query.tolerance
    ) {
      return false;
    }
  }
  return (
    query.sectionPlane === undefined ||
    maxBoundsDistance(query.elementBounds, base, query.transform, query.sectionPlane) >=
      -query.tolerance
  );
}

function isAffineTransform(transform: Mat4): boolean {
  return (
    matrixValue(transform, 3) === 0 &&
    matrixValue(transform, 7) === 0 &&
    matrixValue(transform, 11) === 0 &&
    matrixValue(transform, 15) === 1
  );
}

function maxBoundsDistance(
  bounds: Float64Array,
  base: number,
  transform: Mat4,
  plane: { readonly normal: Vec3; readonly distance: number },
): number {
  const minX = bounds[base] ?? Infinity;
  const minY = bounds[base + 1] ?? Infinity;
  const minZ = bounds[base + 2] ?? Infinity;
  const maxX = bounds[base + 3] ?? -Infinity;
  const maxY = bounds[base + 4] ?? -Infinity;
  const maxZ = bounds[base + 5] ?? -Infinity;
  const x =
    plane.normal[0] * matrixValue(transform, 0) +
    plane.normal[1] * matrixValue(transform, 1) +
    plane.normal[2] * matrixValue(transform, 2);
  const y =
    plane.normal[0] * matrixValue(transform, 4) +
    plane.normal[1] * matrixValue(transform, 5) +
    plane.normal[2] * matrixValue(transform, 6);
  const z =
    plane.normal[0] * matrixValue(transform, 8) +
    plane.normal[1] * matrixValue(transform, 9) +
    plane.normal[2] * matrixValue(transform, 10);
  const constant =
    plane.normal[0] * matrixValue(transform, 12) +
    plane.normal[1] * matrixValue(transform, 13) +
    plane.normal[2] * matrixValue(transform, 14) +
    plane.distance;
  return (
    constant +
    (x >= 0 ? x * maxX : x * minX) +
    (y >= 0 ? y * maxY : y * minY) +
    (z >= 0 ? z * maxZ : z * minZ)
  );
}

function matrixValue(matrix: Mat4, index: number): number {
  return matrix[index] ?? 0;
}

function writePrimitivePoints(
  query: ElementQuery,
  geometry: Geometry,
  offset: number,
  arity: number,
): boolean {
  const displacements = query.deformation?.displacements.get(query.part.id);
  const scale = query.deformation?.scale ?? 1;
  for (let index = 0; index < arity; index += 1) {
    const vertexIndex = geometry.indices[offset + index];
    const target = query.points[index];
    if (vertexIndex === undefined || target === undefined) return false;
    const base = vertexIndex * 3;
    const x = geometry.positions[base];
    const y = geometry.positions[base + 1];
    const z = geometry.positions[base + 2];
    if (x === undefined || y === undefined || z === undefined) return false;
    const nodePickId = geometry.nodePickIds?.[vertexIndex];
    const displacementBase =
      nodePickId === undefined || nodePickId === 0 ? -1 : (nodePickId - 1) * 3;
    const dx = displacementBase < 0 ? undefined : displacements?.[displacementBase];
    const dy = displacementBase < 0 ? undefined : displacements?.[displacementBase + 1];
    const dz = displacementBase < 0 ? undefined : displacements?.[displacementBase + 2];
    const hasDisplacement = Number.isFinite(dx) && Number.isFinite(dy) && Number.isFinite(dz);
    const localX = hasDisplacement ? x + (dx ?? 0) * scale : x;
    const localYValue = hasDisplacement ? y + (dy ?? 0) * scale : y;
    const localZ = hasDisplacement ? z + (dz ?? 0) * scale : z;
    const transformedX =
      matrixValue(query.transform, 0) * localX +
      matrixValue(query.transform, 4) * localYValue +
      matrixValue(query.transform, 8) * localZ +
      matrixValue(query.transform, 12);
    const transformedY =
      matrixValue(query.transform, 1) * localX +
      matrixValue(query.transform, 5) * localYValue +
      matrixValue(query.transform, 9) * localZ +
      matrixValue(query.transform, 13);
    const transformedZ =
      matrixValue(query.transform, 2) * localX +
      matrixValue(query.transform, 6) * localYValue +
      matrixValue(query.transform, 10) * localZ +
      matrixValue(query.transform, 14);
    const w =
      matrixValue(query.transform, 3) * localX +
      matrixValue(query.transform, 7) * localYValue +
      matrixValue(query.transform, 11) * localZ +
      matrixValue(query.transform, 15);
    const divisor = w === 0 ? 1 : w;
    target[0] = transformedX / divisor;
    target[1] = transformedY / divisor;
    target[2] = transformedZ / divisor;
  }
  return true;
}

function primitiveIntersectsFrustum(
  points: readonly Vec3[],
  pointCount: number,
  frustum: BoxSelectionFrustum,
  sectionPlane: SectionPlane | undefined,
  tolerance: number,
): boolean {
  if (pointCount === 1) {
    const point = points[0];
    return point === undefined ? false : insideFrustum(point, frustum, sectionPlane, tolerance);
  }
  let clipped = false;
  for (const name of FRUSTUM_PLANES) {
    const plane = frustum[name];
    const inside = insideCount(points, pointCount, plane.normal, plane.distance, tolerance);
    if (inside === 0) return false;
    clipped ||= inside < pointCount;
  }
  if (sectionPlane !== undefined) {
    const inside = insideCount(
      points,
      pointCount,
      sectionPlane.normal,
      sectionPlane.distance,
      tolerance,
    );
    if (inside === 0) return false;
    clipped ||= inside < pointCount;
  }
  if (!clipped) return true;
  let polygon = points.slice(0, pointCount);
  for (const name of FRUSTUM_PLANES) {
    polygon = clipPolygon(polygon, frustum[name].normal, frustum[name].distance, tolerance);
    if (polygon.length === 0) return false;
  }
  if (sectionPlane !== undefined) {
    polygon = clipPolygon(polygon, sectionPlane.normal, sectionPlane.distance, tolerance);
  }
  return polygon.length > 0;
}

function insideCount(
  points: readonly Vec3[],
  pointCount: number,
  normal: Vec3,
  distance: number,
  tolerance: number,
): number {
  let count = 0;
  for (let index = 0; index < pointCount; index += 1) {
    const point = points[index];
    if (point !== undefined && signedDistance(normal, distance, point) >= -tolerance) count += 1;
  }
  return count;
}

function insideFrustum(
  point: Vec3,
  frustum: BoxSelectionFrustum,
  sectionPlane: SectionPlane | undefined,
  tolerance: number,
): boolean {
  if (
    !FRUSTUM_PLANES.every(
      (name) => signedDistance(frustum[name].normal, frustum[name].distance, point) >= -tolerance,
    )
  ) {
    return false;
  }
  return (
    sectionPlane === undefined ||
    signedDistance(sectionPlane.normal, sectionPlane.distance, point) >= -tolerance
  );
}

function clipPolygon(
  polygon: readonly Vec3[],
  normal: Vec3,
  distance: number,
  tolerance: number,
): Vec3[] {
  const clipped: Vec3[] = [];
  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index];
    const previous = polygon[(index + polygon.length - 1) % polygon.length];
    if (current === undefined || previous === undefined) continue;
    const currentDistance = signedDistance(normal, distance, current);
    const previousDistance = signedDistance(normal, distance, previous);
    const currentInside = currentDistance >= -tolerance;
    const previousInside = previousDistance >= -tolerance;
    if (currentInside !== previousInside) {
      const denominator = previousDistance - currentDistance;
      const ratio = denominator === 0 ? 0 : previousDistance / denominator;
      clipped.push(interpolate(previous, current, ratio));
    }
    if (currentInside) clipped.push(current);
  }
  return clipped;
}

function interpolate(left: Vec3, right: Vec3, ratio: number): Vec3 {
  return [
    left[0] + (right[0] - left[0]) * ratio,
    left[1] + (right[1] - left[1]) * ratio,
    left[2] + (right[2] - left[2]) * ratio,
  ];
}

function signedDistance(normal: Vec3, distance: number, point: Vec3): number {
  return normal[0] * point[0] + normal[1] * point[1] + normal[2] * point[2] + distance;
}
