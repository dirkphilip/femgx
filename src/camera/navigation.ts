import type { Bounds } from "../geometry/part";
import { dot, normalize, subtract, type Vec3 } from "../math/vec3";
import {
  orbitCamera,
  projectPoint,
  unprojectPoint,
  zoomCamera,
  zoomCameraAtPoint,
  type Camera,
} from "./camera";

/** Orbits around a pivot while keeping the supplied bounds in front of the camera. */
export function orbitCameraWithinBounds(
  camera: Camera,
  yawDelta: number,
  pitchDelta: number,
  pivot: Vec3 | undefined,
  bounds: Bounds,
): Camera {
  assertFinite("orbit yaw", yawDelta);
  assertFinite("orbit pitch", pitchDelta);
  if (yawDelta === 0 && pitchDelta === 0) return camera;
  return transitionWithinBounds(camera, bounds, (value, progress) =>
    orbitCamera(value, yawDelta * progress, pitchDelta * progress, pivot),
  );
}

/** Selects bounded or generic orbiting for controls with an optional bounds supplier. */
export function orbitCameraWithOptionalBounds(
  camera: Camera,
  yawDelta: number,
  pitchDelta: number,
  pivot: Vec3 | undefined,
  bounds: Bounds | undefined,
): Camera {
  return bounds === undefined
    ? orbitCamera(camera, yawDelta, pitchDelta, pivot)
    : orbitCameraWithinBounds(camera, yawDelta, pitchDelta, pivot, bounds);
}

const SAFE_MARGIN_FRACTION = 1e-5;
const MIN_NEAR_FRACTION = 1e-7;
const SEARCH_STEPS = 32;

/** Zooms toward the target while keeping the supplied bounds in front of the camera. */
export function zoomCameraWithinBounds(camera: Camera, amount: number, bounds: Bounds): Camera {
  assertFinite("zoom amount", amount);
  if (amount === 0) return camera;
  return transitionWithinBounds(camera, bounds, (value, progress) =>
    zoomCamera(value, amount * progress),
  );
}

/** Zooms around a point while keeping the supplied bounds in front of the camera. */
export function zoomCameraAtPointWithinBounds(
  camera: Camera,
  amount: number,
  pivot: Vec3,
  bounds: Bounds,
): Camera {
  assertFinite("zoom amount", amount);
  if (amount === 0) return camera;
  return transitionWithinBounds(camera, bounds, (value, progress) =>
    zoomCameraAtPoint(value, amount * progress, pivot),
  );
}

/** Returns the world point under a CSS pixel on the view-aligned target plane. */
export function targetPlanePoint(camera: Camera, x: number, y: number): Vec3 {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error("Camera target-plane coordinates must be finite");
  }
  const targetScreen = projectPoint(camera, camera.target);
  if (targetScreen === undefined) throw new Error("Camera target must be projectable");
  return unprojectPoint(camera, [x, y, targetScreen[2]]);
}

function transitionWithinBounds(
  camera: Camera,
  bounds: Bounds,
  transition: (camera: Camera, progress: number) => Camera,
): Camera {
  const margin = cameraDepthMargin(bounds);
  if (minimumDepth(camera, bounds) <= margin) return camera;
  const requested = transition(camera, 1);
  const progress =
    minimumDepth(requested, bounds) > margin ? 1 : safeProgress(camera, bounds, margin, transition);
  if (progress === 0) return camera;
  return updateClipPlanes(transition(camera, progress), bounds, margin);
}

function safeProgress(
  camera: Camera,
  bounds: Bounds,
  margin: number,
  transition: (camera: Camera, progress: number) => Camera,
): number {
  let low = 0;
  let high = 1;
  for (let step = 0; step < SEARCH_STEPS; step += 1) {
    const middle = (low + high) / 2;
    const candidate = transition(camera, middle);
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
