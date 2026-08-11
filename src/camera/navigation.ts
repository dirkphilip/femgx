import type { Bounds } from "../geometry/part";
import { dot, normalize, subtract, type Vec3 } from "../math/vec3";
import { zoomCamera, zoomCameraAtPoint, type Camera } from "./camera";

const SAFE_MARGIN_FRACTION = 1e-5;
const MIN_NEAR_FRACTION = 1e-7;
const SEARCH_STEPS = 32;

/** Zooms toward the target while keeping the supplied bounds in front of the camera. */
export function zoomCameraWithinBounds(camera: Camera, amount: number, bounds: Bounds): Camera {
  return zoomWithinBounds(camera, amount, bounds, (value, step) => zoomCamera(value, step));
}

/** Zooms around a point while keeping the supplied bounds in front of the camera. */
export function zoomCameraAtPointWithinBounds(
  camera: Camera,
  amount: number,
  pivot: Vec3,
  bounds: Bounds,
): Camera {
  return zoomWithinBounds(camera, amount, bounds, (value, step) =>
    zoomCameraAtPoint(value, step, pivot),
  );
}

function zoomWithinBounds(
  camera: Camera,
  amount: number,
  bounds: Bounds,
  transition: (camera: Camera, amount: number) => Camera,
): Camera {
  assertFinite("zoom amount", amount);
  if (amount === 0) return camera;
  const margin = cameraDepthMargin(bounds);
  if (minimumDepth(camera, bounds) <= margin) return camera;
  const requested = transition(camera, amount);
  const progress =
    minimumDepth(requested, bounds) > margin
      ? 1
      : safeProgress(camera, amount, bounds, margin, transition);
  if (progress === 0) return camera;
  return updateClipPlanes(transition(camera, amount * progress), bounds, margin);
}

function safeProgress(
  camera: Camera,
  amount: number,
  bounds: Bounds,
  margin: number,
  transition: (camera: Camera, amount: number) => Camera,
): number {
  let low = 0;
  let high = 1;
  for (let step = 0; step < SEARCH_STEPS; step += 1) {
    const middle = (low + high) / 2;
    const candidate = transition(camera, amount * middle);
    if (minimumDepth(candidate, bounds) > margin) low = middle;
    else high = middle;
  }
  return low;
}

function updateClipPlanes(camera: Camera, bounds: Bounds, margin: number): Camera {
  const depths = boundsDepths(camera, bounds);
  const nearest = Math.min(...depths);
  const farthest = Math.max(...depths);
  const scale = boundsScale(bounds);
  const near = Math.max(scale * MIN_NEAR_FRACTION, nearest * 0.25);
  const far = Math.max(farthest + margin, near + margin);
  return { ...camera, near, far };
}

function minimumDepth(camera: Camera, bounds: Bounds): number {
  return Math.min(...boundsDepths(camera, bounds));
}

function boundsDepths(camera: Camera, bounds: Bounds): number[] {
  const forward = normalize(subtract(camera.target, camera.position));
  return boundsCorners(bounds).map((corner) => dot(subtract(corner, camera.position), forward));
}

/** Returns the scale-aware depth margin shared by fitting and navigation. */
export function cameraDepthMargin(bounds: Bounds): number {
  return boundsScale(bounds) * SAFE_MARGIN_FRACTION;
}

function boundsScale(bounds: Bounds): number {
  return Math.max(
    Math.abs(bounds.maxX - bounds.minX),
    Math.abs(bounds.maxY - bounds.minY),
    Math.abs(bounds.maxZ - bounds.minZ),
    1e-9,
  );
}

function boundsCorners(bounds: Bounds): readonly Vec3[] {
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

function assertFinite(name: string, value: number): void {
  if (!Number.isFinite(value)) throw new Error(`Camera ${name} must be finite`);
}
