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

/**
 * Zooms around a point while keeping the supplied bounds in front of the camera.
 * A confirmed displayed point can provide the local approach limit; omitting it
 * retains conservative whole-AABB admission for empty-space anchors.
 */
export function zoomCameraAtPointWithinBounds(
  camera: Camera,
  amount: number,
  pivot: Vec3,
  bounds: Bounds,
  approachPoint?: Vec3,
): Camera {
  assertFinite("zoom amount", amount);
  if (amount === 0) return camera;
  if (approachPoint !== undefined) assertFiniteVector("zoom approach point", approachPoint);
  return transitionWithinBounds(
    camera,
    bounds,
    (value, progress) => zoomCameraAtPoint(value, amount * progress, pivot),
    approachPoint,
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
  approachPoint?: Vec3,
): Camera {
  const margin = cameraDepthMargin(bounds);
  if (transitionMinimumDepth(camera, bounds, approachPoint) <= margin) return camera;
  const requested = transition(camera, 1);
  const progress =
    transitionMinimumDepth(requested, bounds, approachPoint) > margin
      ? 1
      : safeProgress(camera, bounds, margin, transition, approachPoint);
  if (progress === 0) return camera;
  return updateClipPlanes(transition(camera, progress), bounds, margin, approachPoint);
}

function safeProgress(
  camera: Camera,
  bounds: Bounds,
  margin: number,
  transition: (camera: Camera, progress: number) => Camera,
  approachPoint?: Vec3,
): number {
  let low = 0;
  let high = 1;
  for (let step = 0; step < SEARCH_STEPS; step += 1) {
    const middle = (low + high) / 2;
    const candidate = transition(camera, middle);
    if (transitionMinimumDepth(candidate, bounds, approachPoint) > margin) low = middle;
    else high = middle;
  }
  return low;
}

function updateClipPlanes(
  camera: Camera,
  bounds: Bounds,
  margin: number,
  approachPoint?: Vec3,
): Camera {
  const depths = boundsDepths(camera, bounds);
  const positiveDepths = depths.filter((depth) => depth > 0);
  const nearest = Math.min(...(positiveDepths.length > 0 ? positiveDepths : [margin]));
  const farthest = Math.max(...(positiveDepths.length > 0 ? positiveDepths : [margin]));
  const scale = boundsScale(bounds);
  const approachDepth =
    approachPoint === undefined ? Number.POSITIVE_INFINITY : pointDepth(camera, approachPoint);
  const depthLimit = Math.min(nearest, approachDepth) * 0.25;
  const near = Math.max(
    Number.MIN_VALUE,
    Math.min(Math.max(scale * MIN_NEAR_FRACTION, nearest * 0.25), depthLimit),
  );
  const far = Math.max(farthest + margin, near + margin);
  return { ...camera, near, far };
}

function minimumDepth(camera: Camera, bounds: Bounds): number {
  return Math.min(...boundsDepths(camera, bounds));
}

function transitionMinimumDepth(camera: Camera, bounds: Bounds, approachPoint?: Vec3): number {
  return approachPoint === undefined
    ? minimumDepth(camera, bounds)
    : pointDepth(camera, approachPoint);
}

function boundsDepths(camera: Camera, bounds: Bounds): number[] {
  const forward = normalize(subtract(camera.target, camera.position));
  return boundsCorners(bounds).map((corner) => dot(subtract(corner, camera.position), forward));
}

function pointDepth(camera: Camera, point: Vec3): number {
  const forward = normalize(subtract(camera.target, camera.position));
  return dot(subtract(point, camera.position), forward);
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

function assertFiniteVector(name: string, value: Vec3): void {
  if (value.some((component) => !Number.isFinite(component))) {
    throw new Error(`Camera ${name} must contain three finite components`);
  }
}
