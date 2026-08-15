import type { NodeId } from "../elements/element";
import { cross, dot, length, subtract, type Vec3 } from "../math/vec3";

/** Machine-readable failures for compact surface-part authoring. */
export type SurfacePartValidationCode =
  | "invalid-positions"
  | "invalid-connectivity"
  | "record-count-mismatch"
  | "invalid-element-id"
  | "invalid-face-index"
  | "duplicate-face"
  | "too-few-nodes"
  | "invalid-node-id"
  | "duplicate-node"
  | "degenerate"
  | "non-planar"
  | "self-intersecting";

/** Typed failure raised before invalid compact topology reaches a renderer. */
export class SurfacePartError extends Error {
  readonly code: SurfacePartValidationCode;

  constructor(code: SurfacePartValidationCode, message: string) {
    super(message);
    this.name = "SurfacePartError";
    this.code = code;
  }
}

type Vec2 = readonly [number, number];

const EPSILON = 1e-9;
const PLANAR_EPSILON = 1e-6;

/** Deterministically triangulates one simple planar polygon in node space. */
export function triangulatePolygon(
  nodeIds: readonly NodeId[],
  positions: Float32Array,
): readonly (readonly [NodeId, NodeId, NodeId])[] {
  const points = validatePolygon(nodeIds, positions);
  const normal = polygonNormal(points);
  validatePlanarity(points, normal);
  const projected = projectPoints(points, normal);
  const scale = polygonScale(projected);
  rejectIntersections(projected, scale);
  const area = signedArea(projected);
  if (Math.abs(area) <= EPSILON * scale * scale) {
    throw new SurfacePartError("degenerate", "Polygon has zero projected area");
  }
  return earClip(nodeIds, projected, area, scale);
}

function validatePolygon(nodeIds: readonly NodeId[], positions: Float32Array): readonly Vec3[] {
  if (nodeIds.length < 3) {
    throw new SurfacePartError(
      "too-few-nodes",
      `Polygon requires at least 3 node ids but got ${nodeIds.length}`,
    );
  }
  const nodeCount = positions.length / 3;
  const seen = new Set<NodeId>();
  const points: Vec3[] = [];
  for (const nodeId of nodeIds) {
    if (!Number.isInteger(nodeId) || nodeId < 0 || nodeId >= nodeCount) {
      throw new SurfacePartError(
        "invalid-node-id",
        `Polygon references node ${nodeId}, outside 0..${Math.max(0, nodeCount - 1)}`,
      );
    }
    if (seen.has(nodeId)) {
      throw new SurfacePartError("duplicate-node", `Polygon references node ${nodeId} twice`);
    }
    seen.add(nodeId);
    points.push(pointAt(positions, nodeId));
  }
  return points;
}

function pointAt(positions: Float32Array, nodeId: NodeId): Vec3 {
  const offset = nodeId * 3;
  return [positions[offset] ?? 0, positions[offset + 1] ?? 0, positions[offset + 2] ?? 0];
}

function polygonNormal(points: readonly Vec3[]): Vec3 {
  const origin = points[0];
  if (origin === undefined) throw new SurfacePartError("degenerate", "Polygon has no points");
  const scale = spatialScale(points);
  for (let first = 1; first < points.length - 1; first += 1) {
    for (let second = first + 1; second < points.length; second += 1) {
      const candidate = cross(
        subtract(points[first] ?? origin, origin),
        subtract(points[second] ?? origin, origin),
      );
      if (length(candidate) > EPSILON * scale * scale) return candidate;
    }
  }
  throw new SurfacePartError("degenerate", "Polygon points are collinear");
}

function validatePlanarity(points: readonly Vec3[], normal: Vec3): void {
  const origin = points[0];
  if (origin === undefined) return;
  const normalLength = length(normal);
  const tolerance = PLANAR_EPSILON * spatialScale(points);
  for (const point of points) {
    const distance = Math.abs(dot(subtract(point, origin), normal)) / normalLength;
    if (distance > tolerance) {
      throw new SurfacePartError(
        "non-planar",
        `Polygon node is ${distance} units from its fitted plane (tolerance ${tolerance})`,
      );
    }
  }
}

function projectPoints(points: readonly Vec3[], normal: Vec3): readonly Vec2[] {
  const axis = dominantAxis(normal);
  return points.map((point) => {
    if (axis === 0) return [point[1], point[2]];
    if (axis === 1) return [point[0], point[2]];
    return [point[0], point[1]];
  });
}

function dominantAxis(vector: Vec3): 0 | 1 | 2 {
  const absolute = vector.map(Math.abs);
  if ((absolute[1] ?? 0) > (absolute[0] ?? 0) && (absolute[1] ?? 0) >= (absolute[2] ?? 0)) {
    return 1;
  }
  return (absolute[2] ?? 0) > (absolute[0] ?? 0) ? 2 : 0;
}

function polygonScale(points: readonly Vec2[]): number {
  let scale = 1;
  for (const point of points) scale = Math.max(scale, Math.abs(point[0]), Math.abs(point[1]));
  return scale;
}

function spatialScale(points: readonly Vec3[]): number {
  let scale = 1;
  for (const point of points) {
    scale = Math.max(scale, Math.abs(point[0]), Math.abs(point[1]), Math.abs(point[2]));
  }
  return scale;
}

function signedArea(points: readonly Vec2[]): number {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    if (current === undefined || next === undefined) continue;
    area += current[0] * next[1] - next[0] * current[1];
  }
  return area / 2;
}

function rejectIntersections(points: readonly Vec2[], scale: number): void {
  for (let first = 0; first < points.length; first += 1) {
    const firstNext = (first + 1) % points.length;
    for (let second = first + 1; second < points.length; second += 1) {
      const secondNext = (second + 1) % points.length;
      if (adjacentEdges(first, second, points.length)) continue;
      if (
        segmentsIntersect(
          points[first] as Vec2,
          points[firstNext] as Vec2,
          points[second] as Vec2,
          points[secondNext] as Vec2,
          EPSILON * scale * scale,
        )
      ) {
        throw new SurfacePartError(
          "self-intersecting",
          `Polygon edges ${first}-${firstNext} and ${second}-${secondNext} intersect`,
        );
      }
    }
  }
}

function adjacentEdges(first: number, second: number, count: number): boolean {
  return first === second || (first + 1) % count === second || (second + 1) % count === first;
}

function segmentsIntersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2, epsilon: number): boolean {
  const ab = cross2(a, b, c);
  const abAtD = cross2(a, b, d);
  const cdA = cross2(c, d, a);
  const cdB = cross2(c, d, b);
  if (opposite(ab, abAtD, epsilon) && opposite(cdA, cdB, epsilon)) return true;
  return (
    (nearZero(ab, epsilon) && onSegment(a, b, c, epsilon)) ||
    (nearZero(abAtD, epsilon) && onSegment(a, b, d, epsilon)) ||
    (nearZero(cdA, epsilon) && onSegment(c, d, a, epsilon)) ||
    (nearZero(cdB, epsilon) && onSegment(c, d, b, epsilon))
  );
}

function opposite(first: number, second: number, epsilon: number): boolean {
  return (first > epsilon && second < -epsilon) || (first < -epsilon && second > epsilon);
}

function nearZero(value: number, epsilon: number): boolean {
  return Math.abs(value) <= epsilon;
}

function onSegment(a: Vec2, b: Vec2, point: Vec2, epsilon: number): boolean {
  return (
    point[0] >= Math.min(a[0], b[0]) - epsilon &&
    point[0] <= Math.max(a[0], b[0]) + epsilon &&
    point[1] >= Math.min(a[1], b[1]) - epsilon &&
    point[1] <= Math.max(a[1], b[1]) + epsilon
  );
}

function earClip(
  nodeIds: readonly NodeId[],
  points: readonly Vec2[],
  area: number,
  scale: number,
): readonly (readonly [NodeId, NodeId, NodeId])[] {
  const remaining = Array.from({ length: nodeIds.length }, (_, index) => index);
  const triangles: Array<readonly [NodeId, NodeId, NodeId]> = [];
  const winding = area > 0 ? 1 : -1;
  while (remaining.length > 3) {
    const ear = findEar(remaining, points, winding, scale);
    if (ear === undefined) {
      throw new SurfacePartError(
        "degenerate",
        "Polygon could not be triangulated; check for collinear or overlapping corners",
      );
    }
    const previous = remaining[(ear - 1 + remaining.length) % remaining.length] as number;
    const current = remaining[ear] as number;
    const next = remaining[(ear + 1) % remaining.length] as number;
    triangles.push([
      nodeIds[previous] as NodeId,
      nodeIds[current] as NodeId,
      nodeIds[next] as NodeId,
    ]);
    remaining.splice(ear, 1);
  }
  const [first, second, third] = remaining as [number, number, number];
  triangles.push([nodeIds[first] as NodeId, nodeIds[second] as NodeId, nodeIds[third] as NodeId]);
  return triangles;
}

function findEar(
  remaining: readonly number[],
  points: readonly Vec2[],
  winding: number,
  scale: number,
): number | undefined {
  for (let position = 0; position < remaining.length; position += 1) {
    const previous = remaining[(position - 1 + remaining.length) % remaining.length] as number;
    const current = remaining[position] as number;
    const next = remaining[(position + 1) % remaining.length] as number;
    const turn = cross2(points[previous] as Vec2, points[current] as Vec2, points[next] as Vec2);
    if (turn * winding <= EPSILON * scale * scale) continue;
    if (containsRemainingPoint(remaining, points, [previous, current, next], scale)) continue;
    return position;
  }
  return undefined;
}

function containsRemainingPoint(
  remaining: readonly number[],
  points: readonly Vec2[],
  triangle: readonly [number, number, number],
  scale: number,
): boolean {
  const [previous, current, next] = triangle;
  for (const candidate of remaining) {
    if (candidate === previous || candidate === current || candidate === next) continue;
    if (
      pointInTriangle(
        points[candidate] as Vec2,
        points[previous] as Vec2,
        points[current] as Vec2,
        points[next] as Vec2,
        EPSILON * scale * scale,
      )
    ) {
      return true;
    }
  }
  return false;
}

function pointInTriangle(point: Vec2, a: Vec2, b: Vec2, c: Vec2, epsilon: number): boolean {
  const first = cross2(a, b, point);
  const second = cross2(b, c, point);
  const third = cross2(c, a, point);
  const hasPositive = first > epsilon || second > epsilon || third > epsilon;
  const hasNegative = first < -epsilon || second < -epsilon || third < -epsilon;
  return !(hasPositive && hasNegative);
}

function cross2(a: Vec2, b: Vec2, c: Vec2): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}
