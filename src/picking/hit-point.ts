import type { Camera, Vec3 } from "../camera/camera";
import type { PickTarget } from "../scene/types";

/** Resolves the closest visible GPU-picked point into a world-space position. */
export function hitPointFromPick(
  camera: Camera,
  x: number,
  y: number,
  hit: PickTarget | undefined,
): Vec3 | undefined {
  if (hit?.kind === "node") return hit.worldPosition;
  if (hit?.kind !== "face") return undefined;
  const ray = rayAt(camera, x, y);
  const denominator = dot(ray.direction, hit.normal);
  if (Math.abs(denominator) < 0.000001) return undefined;
  const distance = dot(subtract(hit.hitPosition, ray.origin), hit.normal) / denominator;
  return distance > 0 ? add(ray.origin, scale(ray.direction, distance)) : undefined;
}

/** Returns the world-space camera ray through a camera-pixel position. */
function rayAt(
  camera: Camera,
  x: number,
  y: number,
): { readonly origin: Vec3; readonly direction: Vec3 } {
  const forward = normalize(subtract(camera.target, camera.position));
  const right = normalize(cross(forward, camera.up));
  const up = cross(right, forward);
  const ndcX = (x / camera.width) * 2 - 1;
  const ndcY = 1 - (y / camera.height) * 2;
  const halfHeight =
    camera.mode === "perspective" ? Math.tan(camera.fovY / 2) : camera.orthoHeight / 2;
  const halfWidth = halfHeight * (camera.width / camera.height);
  const offset = add(scale(right, ndcX * halfWidth), scale(up, ndcY * halfHeight));
  return {
    origin: camera.mode === "perspective" ? camera.position : add(camera.position, offset),
    direction: normalize(camera.mode === "perspective" ? add(forward, offset) : forward),
  };
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
