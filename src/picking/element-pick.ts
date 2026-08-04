import type { ElementId } from "../elements/element";
import type { Part } from "../geometry/part";
import { transformPoint } from "../math/mat4";
import type { InstanceId } from "../scene/types";
import type { PickRequest, PickScene } from "./pick-scene";
import { requestRay } from "./pick-scene";
import { intersectRayTriangle, type Ray, type Vec3 } from "./ray";

/**
 * CPU raycast resolution of the nearest element along a camera ray, against the
 * tessellated triangle geometry the renderer draws.
 */

/** A stable element hit in world space. */
export interface ElementPick {
  readonly kind: "element";
  readonly slot: number;
  readonly instanceId: InstanceId;
  readonly partId: number;
  readonly elementId: ElementId;
  readonly position: Vec3;
  readonly normal: Vec3;
  readonly distance: number;
}

/** Returns the nearest element hit along the camera ray, or `undefined`. */
export function pickElement(scene: PickScene, request: PickRequest): ElementPick | undefined {
  const ray = requestRay(request);
  const visibleSlots = request.runtime.getDrawList();
  let nearest: { readonly slot: number; readonly t: number } | undefined;
  let hit:
    { readonly partId: number; readonly elementId: ElementId; readonly normal: Vec3 } | undefined;
  for (const slot of visibleSlots) {
    const partId = request.runtime.instancePartIds[slot];
    if (partId === undefined) continue;
    const part = scene.parts.get(partId);
    if (part === undefined || isLineOrPoint(part)) continue;
    const inspection = scene.inspections.get(partId);
    if (inspection === undefined) continue;
    const transform = request.runtime.instanceWorldTransforms.subarray(slot * 16, slot * 16 + 16);
    const candidate = nearestTriangleHit(ray, part, inspection, transform);
    if (candidate !== undefined && (nearest === undefined || candidate.t < nearest.t)) {
      nearest = { slot, t: candidate.t };
      hit = { partId, elementId: candidate.elementId, normal: candidate.normal };
    }
  }
  if (nearest === undefined || hit === undefined) return undefined;
  return {
    kind: "element",
    slot: nearest.slot,
    instanceId: request.runtime.getInstanceId(nearest.slot) ?? String(nearest.slot),
    partId: hit.partId,
    elementId: hit.elementId,
    position: along(ray, nearest.t),
    normal: hit.normal,
    distance: nearest.t,
  };
}

function nearestTriangleHit(
  ray: Ray,
  part: Part,
  inspection: { readonly triangleElementIds: Uint32Array },
  transform: Float32Array,
): { readonly t: number; readonly elementId: ElementId; readonly normal: Vec3 } | undefined {
  const positions = part.geometry.positions;
  const indices = part.geometry.indices;
  let nearest: { t: number; elementId: ElementId; normal: Vec3 } | undefined;
  for (let triangle = 0; triangle < inspection.triangleElementIds.length; triangle++) {
    const pickId = inspection.triangleElementIds[triangle];
    if (pickId === undefined || pickId === 0) continue;
    const base = triangle * 3;
    const a = worldVertex(transform, positions, indices[base] ?? 0);
    const b = worldVertex(transform, positions, indices[base + 1] ?? 0);
    const c = worldVertex(transform, positions, indices[base + 2] ?? 0);
    const t = intersectRayTriangle(ray, a, b, c);
    if (t === undefined) continue;
    if (nearest === undefined || t < nearest.t) {
      nearest = { t, elementId: pickId - 1, normal: triangleNormal(a, b, c) };
    }
  }
  return nearest;
}

function isLineOrPoint(part: Part): boolean {
  const primitive = part.geometry.primitive;
  return primitive === "lines" || primitive === "points";
}

function worldVertex(transform: Float32Array, positions: Float32Array, index: number): Vec3 {
  const offset = index * 3;
  return transformPoint(
    transform,
    positions[offset] ?? 0,
    positions[offset + 1] ?? 0,
    positions[offset + 2] ?? 0,
  );
}

function triangleNormal(a: Vec3, b: Vec3, c: Vec3): Vec3 {
  const ax = b[0] - a[0];
  const ay = b[1] - a[1];
  const az = b[2] - a[2];
  const bx = c[0] - a[0];
  const by = c[1] - a[1];
  const bz = c[2] - a[2];
  let nx = ay * bz - az * by;
  let ny = az * bx - ax * bz;
  let nz = ax * by - ay * bx;
  const magnitude = Math.hypot(nx, ny, nz);
  if (magnitude === 0) return [0, 0, 1];
  nx /= magnitude;
  ny /= magnitude;
  nz /= magnitude;
  return [nx, ny, nz];
}

function along(ray: Ray, t: number): Vec3 {
  return [
    ray.origin[0] + ray.direction[0] * t,
    ray.origin[1] + ray.direction[1] * t,
    ray.origin[2] + ray.direction[2] * t,
  ];
}
