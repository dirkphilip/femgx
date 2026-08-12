import { boundsCorners, type Bounds } from "../geometry/part";
import { add, dot, length, normalize, scale, subtract, type Vec3 } from "../math/vec3";
import { orbitCamera, zoomCamera, type Camera } from "./camera";

const SAFE_MARGIN_FRACTION = 1e-5;
const MIN_ORTHO_HEIGHT_FRACTION = 0.05;

/** Orbits continuously around a fixed pivot and moves the eye out of protected bounds when necessary. */
export function orbitCameraWithinBounds(
  camera: Camera,
  yawDelta: number,
  pitchDelta: number,
  target: Vec3 | undefined,
  bounds: Bounds,
): Camera {
  assertFinite("orbit yaw", yawDelta);
  assertFinite("orbit pitch", pitchDelta);
  if (target !== undefined) assertFiniteVector("orbit target", target);
  if (yawDelta === 0 && pitchDelta === 0) return camera;
  return constrainCamera(orbitCamera(camera, yawDelta, pitchDelta, target), bounds, undefined);
}

/** Selects bounded or generic orbiting for controls with an optional bounds supplier. */
export function orbitCameraWithOptionalBounds(
  camera: Camera,
  yawDelta: number,
  pitchDelta: number,
  target: Vec3 | undefined,
  bounds: Bounds | undefined,
): Camera {
  if (bounds !== undefined) {
    return orbitCameraWithinBounds(camera, yawDelta, pitchDelta, target, bounds);
  }
  return orbitCamera(camera, yawDelta, pitchDelta, target);
}

/** Zooms toward a fixed target without allowing protected bounds to cross the camera plane. */
export function zoomCameraWithinBounds(
  camera: Camera,
  amount: number,
  bounds: Bounds,
  target?: Vec3,
  protectedBounds?: readonly Bounds[],
): Camera {
  assertFinite("zoom amount", amount);
  if (target !== undefined) assertFiniteVector("zoom target", target);
  if (amount === 0) return camera;
  const focused = target === undefined ? camera : focusCamera(camera, target);
  const forward = normalize(subtract(focused.target, focused.position));
  return constrainCamera(zoomCamera(focused, amount), bounds, protectedBounds, forward);
}

/** Keeps all protected bounds in front of an externally positioned camera. */
export function protectCameraWithinBounds(
  camera: Camera,
  bounds: Bounds,
  protectedBounds?: readonly Bounds[],
): Camera {
  return constrainCamera(camera, bounds, protectedBounds);
}

/** Returns the center of finite navigation bounds. */
export function boundsCenter(bounds: Bounds): Vec3 {
  return [
    (bounds.minX + bounds.maxX) / 2,
    (bounds.minY + bounds.maxY) / 2,
    (bounds.minZ + bounds.maxZ) / 2,
  ];
}

/** Recomputes a bounds-safe clip interval after a camera transition. */
export function updateCameraClipPlanes(
  camera: Camera,
  bounds: Bounds,
  margin = cameraDepthMargin(bounds),
  protectedBounds?: readonly Bounds[],
): Camera {
  const allDepths = [
    ...boundsDepths(camera, bounds),
    ...usableProtectedBounds(bounds, protectedBounds).flatMap((candidate) =>
      boundsDepths(camera, candidate),
    ),
  ];
  const positiveDepths = allDepths.filter((depth) => depth > 0);
  const nearest = Math.min(...(positiveDepths.length > 0 ? positiveDepths : [margin]));
  const farthest = Math.max(...(positiveDepths.length > 0 ? positiveDepths : [margin]));
  const targetDistance = length(subtract(camera.position, camera.target));
  const near = Math.max(Number.MIN_VALUE, Math.min(nearest * 0.25, targetDistance * 0.001));
  const far = Math.max(farthest + margin, near + margin);
  return { ...camera, near, far };
}

/** Returns the nearest signed depth of the world bounds in camera space. */
export function minimumCameraDepth(camera: Camera, bounds: Bounds): number {
  return Math.min(...boundsDepths(camera, bounds));
}

/** Returns the scale-aware depth margin shared by fitting and navigation. */
export function cameraDepthMargin(bounds: Bounds): number {
  return boundsScale(bounds) * SAFE_MARGIN_FRACTION;
}

function focusCamera(camera: Camera, target: Vec3): Camera {
  const translation = subtract(target, camera.target);
  return { ...camera, position: add(camera.position, translation), target };
}

function constrainCamera(
  camera: Camera,
  bounds: Bounds,
  protectedBounds: readonly Bounds[] | undefined,
  fallbackForward?: Vec3,
): Camera {
  const framed =
    camera.mode === "orthographic"
      ? {
          ...camera,
          orthoHeight: Math.max(
            camera.orthoHeight,
            boundsScale(bounds) * MIN_ORTHO_HEIGHT_FRACTION,
          ),
        }
      : camera;
  const adjusted = moveEyeBeforeBounds(
    framed,
    usableProtectedBounds(bounds, protectedBounds),
    fallbackForward,
  );
  return updateCameraClipPlanes(adjusted, bounds, cameraDepthMargin(bounds), protectedBounds);
}

function moveEyeBeforeBounds(
  camera: Camera,
  protectedBounds: readonly Bounds[],
  fallbackForward: Vec3 = [0, 0, -1],
): Camera {
  const forward = normalize(subtract(camera.target, camera.position), fallbackForward, 1e-12);
  const currentDistance = length(subtract(camera.position, camera.target));
  let requiredDistance = currentDistance;
  for (const candidate of protectedBounds) {
    const margin = cameraDepthMargin(candidate) * 1.01;
    for (const corner of boundsCorners(candidate)) {
      requiredDistance = Math.max(
        requiredDistance,
        margin - dot(subtract(corner, camera.target), forward),
      );
    }
  }
  if (requiredDistance === currentDistance) return camera;
  return { ...camera, position: subtract(camera.target, scale(forward, requiredDistance)) };
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
