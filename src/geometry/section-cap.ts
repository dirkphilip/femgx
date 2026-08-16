import type { ElementTessellation, Part } from "./part";
import type { Mat4 } from "../math/mat4";
import { transformPoint } from "../math/mat4";
import type { SectionPlane } from "../math/section-plane";
import { cross, dot, length, normalize, scale, subtract, type Vec3 } from "../math/vec3";

/** A generated cap vertex and its two authored nodal result endpoints. */
export interface SectionCapVertex {
  readonly position: Vec3;
  readonly nodeA: number;
  readonly nodeB: number;
  /** Weight of `nodeB`; `nodeA` carries `1 - weightB`. */
  readonly weightB: number;
}

/** Internal triangulated cap geometry for one element occurrence. */
export interface SectionCap {
  readonly elementId: number;
  readonly vertices: readonly SectionCapVertex[];
  readonly indices: Uint32Array;
}

/** Inputs for the occurrence-aware canonical section builder. */
export interface SectionCapBuildInput {
  readonly part: Part;
  readonly element: ElementTessellation;
  readonly plane: SectionPlane;
  readonly transform: Mat4;
  readonly displacements?: Float32Array;
  readonly deformationScale?: number;
}

interface Edge {
  readonly a: number;
  readonly b: number;
}

interface Candidate extends SectionCapVertex {
  readonly key: string;
}

interface WorldEdge {
  readonly edge: Edge;
  readonly a: Vec3;
  readonly b: Vec3;
}

const SOLID_FAMILIES = new Set(["tet", "wedge", "pyramid", "hex"]);

/** Builds one deterministic, outward-facing cap polygon from authored face edges. */
export function buildElementSectionCap(input: SectionCapBuildInput): SectionCap | undefined {
  const { part, element, plane, transform } = input;
  if (element.shape === undefined || !isSupportedSolid(element.shape.family, element.shape.order)) {
    return undefined;
  }
  const triangles = part.geometries.find((geometry) => geometry.primitive === "triangles");
  const positions = part.nodePositions;
  if (triangles?.primitive !== "triangles" || positions === undefined) return undefined;
  const edges = authoredEdges(triangles.faces, element.id);
  if (edges.length === 0) return undefined;
  const world = (nodeId: number): Vec3 | undefined =>
    worldNode(positions, nodeId, transform, input.displacements, input.deformationScale ?? 1);
  const worldEdges: WorldEdge[] = [];
  for (const edge of edges) {
    const a = world(edge.a);
    const b = world(edge.b);
    if (a === undefined || b === undefined) return undefined;
    worldEdges.push({ edge, a, b });
  }
  const extent = positionExtent(worldEdges.flatMap(({ a, b }) => [a, b]));
  const epsilon = Math.max(1, extent) * 1e-6;
  const { candidates, hasPositive, hasNegative } = collectCandidates(worldEdges, plane, epsilon);
  if (!hasPositive || !hasNegative) return undefined;
  if (candidates.length < 3) return undefined;
  const ordered = orderPolygon(candidates, plane.normal);
  const indices = fanIndices(ordered, plane.normal, epsilon);
  return indices.length < 3 ? undefined : { elementId: element.id, vertices: ordered, indices };
}

function collectCandidates(
  worldEdges: readonly WorldEdge[],
  plane: SectionPlane,
  epsilon: number,
): {
  readonly candidates: Candidate[];
  readonly hasPositive: boolean;
  readonly hasNegative: boolean;
} {
  const candidates: Candidate[] = [];
  let hasPositive = false;
  let hasNegative = false;
  for (const { edge, a, b } of worldEdges) {
    const da = signedDistance(plane, a);
    const db = signedDistance(plane, b);
    if (!Number.isFinite(da) || !Number.isFinite(db)) continue;
    hasPositive ||= da > epsilon || db > epsilon;
    hasNegative ||= da < -epsilon || db < -epsilon;
    if (Math.abs(da) <= epsilon && Math.abs(db) <= epsilon) continue;
    if (Math.abs(da) <= epsilon) {
      addCandidate(
        candidates,
        { position: a, nodeA: edge.a, nodeB: edge.a, weightB: 0, key: edgeKey(edge.a, edge.a) },
        epsilon,
      );
    } else if (Math.abs(db) <= epsilon) {
      addCandidate(
        candidates,
        { position: b, nodeA: edge.b, nodeB: edge.b, weightB: 0, key: edgeKey(edge.b, edge.b) },
        epsilon,
      );
    } else if (da * db < 0) {
      const t = da / (da - db);
      const point: Vec3 = [
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
        a[2] + (b[2] - a[2]) * t,
      ];
      addCandidate(
        candidates,
        { position: point, nodeA: edge.a, nodeB: edge.b, weightB: t, key: edgeKey(edge.a, edge.b) },
        epsilon,
      );
    }
  }
  return { candidates, hasPositive, hasNegative };
}

function isSupportedSolid(family: string, order: number): boolean {
  return (
    SOLID_FAMILIES.has(family) &&
    (family === "wedge" || family === "pyramid" ? order === 1 : order === 1 || order === 2)
  );
}

function authoredEdges(
  faces: readonly { readonly elementId: number; readonly nodeIds: readonly number[] }[] | undefined,
  elementId: number,
): readonly Edge[] {
  const unique = new Map<string, Edge>();
  for (const face of faces ?? []) {
    if (face.elementId !== elementId || face.nodeIds.length < 3) continue;
    for (let index = 0; index < face.nodeIds.length; index += 1) {
      const a = face.nodeIds[index];
      const b = face.nodeIds[(index + 1) % face.nodeIds.length];
      if (a === undefined || b === undefined || a === b) continue;
      const key = edgeKey(a, b);
      if (!unique.has(key)) unique.set(key, { a: Math.min(a, b), b: Math.max(a, b) });
    }
  }
  return [...unique.values()].sort((left, right) =>
    edgeKey(left.a, left.b).localeCompare(edgeKey(right.a, right.b)),
  );
}

function edgeKey(a: number, b: number): string {
  return `${Math.min(a, b)}:${Math.max(a, b)}`;
}

function worldNode(
  positions: Float32Array,
  nodeId: number,
  transform: Mat4,
  displacements: Float32Array | undefined,
  deformationScale: number,
): Vec3 | undefined {
  const offset = nodeId * 3;
  let x = positions[offset];
  let y = positions[offset + 1];
  let z = positions[offset + 2];
  if (x === undefined || y === undefined || z === undefined) return undefined;
  const displacementOffset = nodeId * 3;
  if (displacements !== undefined && displacementOffset + 2 < displacements.length) {
    const dx = displacements[displacementOffset];
    const dy = displacements[displacementOffset + 1];
    const dz = displacements[displacementOffset + 2];
    if (dx !== undefined && dy !== undefined && dz !== undefined) {
      x += dx * deformationScale;
      y += dy * deformationScale;
      z += dz * deformationScale;
    }
  }
  const point = transformPoint(transform, x, y, z);
  return point.every(Number.isFinite) ? point : undefined;
}

function signedDistance(plane: SectionPlane, point: Vec3): number {
  return dot(plane.normal, point) + plane.distance;
}

function positionExtent(points: readonly Vec3[]): number {
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    for (const value of point) {
      minimum = Math.min(minimum, value);
      maximum = Math.max(maximum, value);
    }
  }
  return Number.isFinite(minimum) && Number.isFinite(maximum) ? maximum - minimum : 1;
}

function addCandidate(candidates: Candidate[], candidate: Candidate, epsilon: number): void {
  const duplicate = candidates.find(
    (existing) => distance(existing.position, candidate.position) <= epsilon,
  );
  if (duplicate === undefined) candidates.push(candidate);
  else if (candidate.key < duplicate.key) candidates[candidates.indexOf(duplicate)] = candidate;
}

function distance(a: Vec3, b: Vec3): number {
  return length(subtract(a, b));
}

function orderPolygon(candidates: readonly Candidate[], normal: Vec3): Candidate[] {
  const reference: Vec3 = Math.abs(normal[0]) < 0.8 ? [1, 0, 0] : [0, 1, 0];
  const u = normalize(cross(normal, reference));
  const v = cross(normal, u);
  const center: Vec3 = [
    candidates.reduce((sum, value) => sum + value.position[0], 0) / candidates.length,
    candidates.reduce((sum, value) => sum + value.position[1], 0) / candidates.length,
    candidates.reduce((sum, value) => sum + value.position[2], 0) / candidates.length,
  ];
  return [...candidates].sort((left, right) => {
    const leftDelta = subtract(left.position, center);
    const rightDelta = subtract(right.position, center);
    return (
      Math.atan2(dot(leftDelta, v), dot(leftDelta, u)) -
        Math.atan2(dot(rightDelta, v), dot(rightDelta, u)) || left.key.localeCompare(right.key)
    );
  });
}

function fanIndices(
  vertices: readonly SectionCapVertex[],
  normal: Vec3,
  epsilon: number,
): Uint32Array {
  const result: number[] = [];
  const desired = scale(normal, -1);
  for (let index = 1; index + 1 < vertices.length; index += 1) {
    const a = vertices[0]?.position;
    const b = vertices[index]?.position;
    const c = vertices[index + 1]?.position;
    if (a === undefined || b === undefined || c === undefined) continue;
    const areaNormal = cross(subtract(b, a), subtract(c, a));
    if (length(areaNormal) <= epsilon * epsilon) continue;
    const triangle = dot(areaNormal, desired) < 0 ? [0, index + 1, index] : [0, index, index + 1];
    result.push(...triangle);
  }
  return new Uint32Array(result);
}
