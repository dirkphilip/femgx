import type { Vec3 } from "../camera/camera";
import type { ElementId, NodeId } from "../elements/element";
import type { Geometry } from "../geometry/part";
import type { Instance } from "../scene/types";
import { rayFromCamera, type Ray } from "./ray";
import {
  resolvePickTarget,
  type PickContext,
  type PickGranularity,
  type ResolvedPickIds,
} from "./pick";

/** Builds a world-space pick ray through a pixel for the given camera. */
export const rayFromPixel = rayFromCamera;

export type { Ray as PickRay };

/** Options for the CPU raycast fallback. */
export interface PickFromRayOptions {
  /** Instance slots to consider (typically the visible ones); all when omitted. */
  readonly visibleInstanceIds?: ReadonlySet<number>;
  /** Granularity of the resolved target (default most-specific). */
  readonly granularity?: PickGranularity;
}

/** A world-space triangle together with its geometry data. */
interface HitTriangle {
  readonly triangle: number;
  readonly elementId: ElementId | undefined;
  readonly faceId: number | undefined;
  readonly nodeId: NodeId | undefined;
}

/**
 * CPU fallback for GPU picking: casts a ray against the triangle tessellation
 * of every considered instance and returns the same renderer-independent
 * `PickTarget` the GPU pick pass would produce, with the exact world-space hit
 * position on `face` targets. `undefined` when the ray misses everything.
 */
export function pickFromRay(
  context: PickContext,
  ray: Ray,
  options: PickFromRayOptions = {},
): ReturnType<typeof resolvePickTarget> {
  let nearest:
    | {
        readonly instance: Instance;
        readonly hit: HitTriangle;
        readonly point: Vec3;
        readonly t: number;
      }
    | undefined;
  for (const instance of context.instances) {
    if (
      options.visibleInstanceIds !== undefined &&
      !options.visibleInstanceIds.has(instance.index)
    ) {
      continue;
    }
    const geometry = context.parts.get(instance.partId)?.geometry;
    if (geometry === undefined || geometry.indices.length === 0) {
      continue;
    }
    for (const hit of triangleHits(instance, geometry, ray)) {
      if (nearest === undefined || hit.t < nearest.t) {
        nearest = { instance, hit: hit.hit, point: hit.point, t: hit.t };
      }
    }
  }
  if (nearest === undefined) {
    return undefined;
  }
  const ids: ResolvedPickIds = {
    instancePickId: nearest.instance.index + 1,
    elementPickId: nearest.hit.elementId === undefined ? 0 : nearest.hit.elementId + 1,
    facePickId: nearest.hit.faceId === undefined ? 0 : nearest.hit.faceId + 1,
    nodePickId: nearest.hit.nodeId === undefined ? 0 : nearest.hit.nodeId + 1,
  };
  const target = resolvePickTarget(context, ids, options.granularity);
  if (target !== undefined && target.kind === "face") {
    return { ...target, hitPosition: nearest.point };
  }
  return target;
}

/**
 * Tests every triangle of an instance's geometry.
 * @yields {object} One record per triangle hit by the ray.
 */
function* triangleHits(
  instance: Instance,
  geometry: Geometry,
  ray: Ray,
): Generator<{ readonly hit: HitTriangle; readonly point: Vec3; readonly t: number }> {
  const worldTriangle = worldTriangles(instance, geometry);
  for (let triangle = 0; triangle < worldTriangle.length; triangle++) {
    const corners = worldTriangle[triangle];
    if (corners === undefined) continue;
    const hit = rayTriangle(ray, corners);
    if (hit === undefined) continue;
    yield {
      hit: {
        triangle,
        elementId: elementIdForTriangle(geometry, triangle),
        faceId: faceIdForTriangle(geometry, triangle),
        nodeId: nearestNodeId(instance, geometry, triangle, hit.point),
      },
      point: hit.point,
      t: hit.t,
    };
  }
}

/** Transforms every triangle of a geometry into world space for ray testing. */
function worldTriangles(
  instance: Instance,
  geometry: Geometry,
): ReadonlyArray<readonly [Vec3, Vec3, Vec3]> {
  const triangles: Array<readonly [Vec3, Vec3, Vec3]> = [];
  const { positions, indices } = geometry;
  for (let index = 0; index + 2 < indices.length; index += 3) {
    triangles.push([
      vertexWorld(instance, positions, indices[index]),
      vertexWorld(instance, positions, indices[index + 1]),
      vertexWorld(instance, positions, indices[index + 2]),
    ]);
  }
  return triangles;
}

function vertexWorld(
  instance: Instance,
  positions: Float32Array,
  vertex: number | undefined,
): Vec3 {
  const offset = (vertex ?? 0) * 3;
  const x = positions[offset] ?? 0;
  const y = positions[offset + 1] ?? 0;
  const z = positions[offset + 2] ?? 0;
  const transform = instance.worldTransform;
  const w =
    (transform[3] ?? 0) * x +
    (transform[7] ?? 0) * y +
    (transform[11] ?? 0) * z +
    (transform[15] ?? 0);
  const divisor = w === 0 ? 1 : w;
  return [
    ((transform[0] ?? 0) * x +
      (transform[4] ?? 0) * y +
      (transform[8] ?? 0) * z +
      (transform[12] ?? 0)) /
      divisor,
    ((transform[1] ?? 0) * x +
      (transform[5] ?? 0) * y +
      (transform[9] ?? 0) * z +
      (transform[13] ?? 0)) /
      divisor,
    ((transform[2] ?? 0) * x +
      (transform[6] ?? 0) * y +
      (transform[10] ?? 0) * z +
      (transform[14] ?? 0)) /
      divisor,
  ];
}

/** Möller–Trumbore ray-triangle intersection, returning the hit point and t. */
function rayTriangle(
  ray: Ray,
  triangle: readonly [Vec3, Vec3, Vec3],
): { readonly point: Vec3; readonly t: number } | undefined {
  const a = triangle[0];
  const b = triangle[1];
  const c = triangle[2];
  const edge1 = subtract(b, a);
  const edge2 = subtract(c, a);
  const h = cross(ray.direction, edge2);
  const determinant = dot(edge1, h);
  if (Math.abs(determinant) < 1e-12) {
    return undefined;
  }
  const inverse = 1 / determinant;
  const s = subtract(ray.origin, a);
  const u = dot(s, h) * inverse;
  if (u < 0 || u > 1) {
    return undefined;
  }
  const q = cross(s, edge1);
  const v = dot(ray.direction, q) * inverse;
  if (v < 0 || u + v > 1) {
    return undefined;
  }
  const t = dot(edge2, q) * inverse;
  if (t <= 0) {
    return undefined;
  }
  return {
    t,
    point: [
      ray.origin[0] + ray.direction[0] * t,
      ray.origin[1] + ray.direction[1] * t,
      ray.origin[2] + ray.direction[2] * t,
    ],
  };
}

/** Returns the element covering a triangle, when the geometry declares elements. */
function elementIdForTriangle(geometry: Geometry, triangle: number): ElementId | undefined {
  for (const element of geometry.elements ?? []) {
    const end = element.triangleStart + element.triangleCount;
    if (triangle >= element.triangleStart && triangle < end) {
      return element.id;
    }
  }
  return undefined;
}

/** Returns the 0-based face id of a triangle, or `undefined`. */
function faceIdForTriangle(geometry: Geometry, triangle: number): number | undefined {
  const pickId = geometry.facePickIds?.[triangle];
  return pickId === undefined || pickId === 0 ? undefined : pickId - 1;
}

/** Returns the node id nearest to `point` among a triangle's vertices. */
function nearestNodeId(
  instance: Instance,
  geometry: Geometry,
  triangle: number,
  point: Vec3,
): NodeId | undefined {
  const nodePickIds = geometry.nodePickIds;
  if (nodePickIds === undefined) {
    return undefined;
  }
  const base = triangle * 3;
  let nearest: { readonly nodeId: NodeId; readonly distance: number } | undefined;
  for (let corner = 0; corner < 3; corner++) {
    const pickId = nodePickIds[base + corner] ?? 0;
    if (pickId === 0) continue;
    const nodeId = pickId - 1;
    const distance = distanceToNodeWorld(instance, geometry, nodeId, point);
    if (nearest === undefined || distance < nearest.distance) {
      nearest = { nodeId, distance };
    }
  }
  return nearest?.nodeId;
}

function distanceToNodeWorld(
  instance: Instance,
  geometry: Geometry,
  nodeId: NodeId,
  point: Vec3,
): number {
  const positions = geometry.nodePositions;
  if (positions === undefined) return Infinity;
  const world = vertexWorld(instance, positions, nodeId);
  return Math.hypot(point[0] - world[0], point[1] - world[1], point[2] - world[2]);
}

function subtract(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
