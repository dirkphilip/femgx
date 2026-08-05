import type { Camera, Vec3 } from "../camera/camera";

/**
 * CPU-side ray construction and intersection helpers used by the demo's
 * unified element/face/node picking. Pure math; no renderer dependency.
 */

/** A world-space ray used for CPU raycasting. */
export interface Ray {
  readonly origin: Vec3;
  readonly direction: Vec3;
}

export type { Vec3 } from "../camera/camera";

/** Builds the world-space ray through a client-space pixel of the camera. */
export function rayFromCamera(camera: Camera, x: number, y: number): Ray {
  const ndcX = (x / camera.width) * 2 - 1;
  const ndcY = 1 - (y / camera.height) * 2;
  const forward = normalize(subtract(camera.target, camera.position));
  const right = normalize(cross(forward, camera.up));
  const up = cross(right, forward);
  if (camera.mode === "orthographic") {
    const halfW = (camera.orthoHeight * camera.width) / camera.height / 2;
    const halfH = camera.orthoHeight / 2;
    const origin = add(camera.position, add(scale(right, ndcX * halfW), scale(up, ndcY * halfH)));
    return { origin, direction: forward };
  }
  const tanHalfFov = Math.tan(camera.fovY / 2);
  const aspect = camera.width / camera.height;
  const direction = normalize(
    add(forward, add(scale(right, ndcX * tanHalfFov * aspect), scale(up, ndcY * tanHalfFov))),
  );
  return { origin: camera.position, direction };
}

/**
 * Möller–Trumbore ray/triangle intersection. Returns the ray parameter `t`
 * (distance from the ray origin) or `undefined` when the ray misses or the
 * triangle faces away from the ray.
 */
export function intersectRayTriangle(ray: Ray, a: Vec3, b: Vec3, c: Vec3): number | undefined {
  const edge1 = subtract(b, a);
  const edge2 = subtract(c, a);
  const h = cross(ray.direction, edge2);
  const determinant = dot(edge1, h);
  if (Math.abs(determinant) < 1e-9) {
    return undefined;
  }
  const f = 1 / determinant;
  const s = subtract(ray.origin, a);
  const u = f * dot(s, h);
  if (u < 0 || u > 1) {
    return undefined;
  }
  const q = cross(s, edge1);
  const v = f * dot(ray.direction, q);
  if (v < 0 || u + v > 1) {
    return undefined;
  }
  const t = f * dot(edge2, q);
  return t >= 0 ? t : undefined;
}

function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function subtract(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function scale(vector: Vec3, amount: number): Vec3 {
  return [vector[0] * amount, vector[1] * amount, vector[2] * amount];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function normalize(vector: Vec3): Vec3 {
  const magnitude = Math.hypot(vector[0], vector[1], vector[2]);
  return magnitude === 0 ? [0, 0, 1] : scale(vector, 1 / magnitude);
}
