import { boundsCorners, type Bounds } from "../geometry/part";
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

interface ZoomProtection {
  readonly approachPoint?: Vec3;
  readonly protectedBounds?: readonly Bounds[];
}

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
  protection?: ZoomProtection,
): Camera {
  assertFinite("zoom amount", amount);
  if (amount === 0) return camera;
  const approachPoint = protection?.approachPoint;
  const protectedBounds = protection?.protectedBounds;
  if (approachPoint !== undefined) assertFiniteVector("zoom approach point", approachPoint);
  return transitionWithinBounds(
    camera,
    bounds,
    (value, progress) => zoomCameraAtPoint(value, amount * progress, pivot),
    approachPoint,
    protectedBounds,
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
  protectedBounds?: readonly Bounds[],
): Camera {
  if (transitionSafety(camera, bounds, approachPoint, protectedBounds) <= 0) return camera;
  const requested = transition(camera, 1);
  const progress =
    transitionSafety(requested, bounds, approachPoint, protectedBounds) > 0
      ? 1
      : safeProgress(camera, bounds, transition, approachPoint, protectedBounds);
  if (progress === 0) return camera;
  return updateCameraClipPlanes(
    transition(camera, progress),
    bounds,
    cameraDepthMargin(bounds),
    approachPoint,
    protectedBounds,
  );
}

function safeProgress(
  camera: Camera,
  bounds: Bounds,
  transition: (camera: Camera, progress: number) => Camera,
  approachPoint?: Vec3,
  protectedBounds?: readonly Bounds[],
): number {
  let low = 0;
  let high = 1;
  for (let step = 0; step < SEARCH_STEPS; step += 1) {
    const middle = (low + high) / 2;
    const candidate = transition(camera, middle);
    if (transitionSafety(candidate, bounds, approachPoint, protectedBounds) > 0) low = middle;
    else high = middle;
  }
  return low;
}

/** Recomputes the bounds-safe clip interval after a camera transition. */
export function updateCameraClipPlanes(
  camera: Camera,
  bounds: Bounds,
  margin = cameraDepthMargin(bounds),
  approachPoint?: Vec3,
  protectedBounds?: readonly Bounds[],
): Camera {
  const protectedDepthValues = protectedDepths(camera, bounds, protectedBounds);
  const allDepths = [...boundsDepths(camera, bounds), ...protectedDepthValues];
  const positiveDepths = allDepths.filter((depth) => depth > 0);
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

/** Returns the nearest signed depth of the world bounds in camera space. */
export function minimumCameraDepth(camera: Camera, bounds: Bounds): number {
  return Math.min(...boundsDepths(camera, bounds));
}

function transitionSafety(
  camera: Camera,
  bounds: Bounds,
  approachPoint: Vec3 | undefined,
  protectedBounds: readonly Bounds[] | undefined,
): number {
  const candidates = safetyBounds(bounds, approachPoint, protectedBounds);
  const geometrySafety = Math.min(
    ...candidates.map(
      (candidate) => minimumCameraDepth(camera, candidate) - cameraDepthMargin(candidate),
    ),
  );
  const approachSafety =
    approachPoint === undefined
      ? Number.POSITIVE_INFINITY
      : pointDepth(camera, approachPoint) - cameraDepthMargin(bounds);
  return Math.min(geometrySafety, approachSafety);
}

function safetyBounds(
  bounds: Bounds,
  approachPoint: Vec3 | undefined,
  protectedBounds: readonly Bounds[] | undefined,
): readonly Bounds[] {
  if (protectedBounds === undefined) return approachPoint === undefined ? [bounds] : [];
  return protectedBounds.length === 0 ? [bounds] : protectedBounds;
}

function protectedDepths(
  camera: Camera,
  bounds: Bounds,
  protectedBounds: readonly Bounds[] | undefined,
): number[] {
  return usableProtectedBounds(bounds, protectedBounds).flatMap((candidate) =>
    boundsDepths(camera, candidate),
  );
}

function usableProtectedBounds(
  bounds: Bounds,
  protectedBounds: readonly Bounds[] | undefined,
): readonly Bounds[] {
  return protectedBounds === undefined || protectedBounds.length === 0 ? [bounds] : protectedBounds;
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

function assertFinite(name: string, value: number): void {
  if (!Number.isFinite(value)) throw new Error(`Camera ${name} must be finite`);
}

function assertFiniteVector(name: string, value: Vec3): void {
  if (value.some((component) => !Number.isFinite(component))) {
    throw new Error(`Camera ${name} must contain three finite components`);
  }
}
