import { assertValidCamera, viewMatrix, type Camera } from "../camera/camera";
import { dot, length, scale, subtract, type Vec3 } from "../math/vec3";
import type { BoxSelectionRect } from "./box-selection";

/**
 * One normalized world-space plane using `dot(normal, point) + distance >= 0`.
 * @category Interaction and picking
 */
export interface FrustumPlane {
  readonly normal: Vec3;
  readonly distance: number;
}

/**
 * Named planes of a camera-aligned box-selection frustum.
 * These are six inward-facing world-space planes for the complete camera
 * depth range, not a raster-occlusion result. Test authoritative placed FE
 * geometry against them for Through element selection.
 * @category Interaction and picking
 */
export interface BoxSelectionFrustum {
  readonly left: FrustumPlane;
  readonly right: FrustumPlane;
  readonly top: FrustumPlane;
  readonly bottom: FrustumPlane;
  readonly near: FrustumPlane;
  readonly far: FrustumPlane;
}

/**
 * Derives the normalized world-space frustum for a screen-space selection box.
 * The returned planes face inward: points inside or on every plane satisfy
 * `dot(plane.normal, point) + plane.distance >= 0`. The rectangle is in
 * canvas CSS pixels and is clamped to the camera viewport; it must have
 * positive area. The result is a pure query and does not inspect GPU state.
 * @category Interaction and picking
 */
export function boxSelectionFrustum(camera: Camera, rect: BoxSelectionRect): BoxSelectionFrustum {
  assertValidCamera(camera);
  const bounds = clampedBounds(camera, rect);
  const basis = cameraBasis(camera);
  const verticalHalfExtent = camera.mode === "perspective" ? Math.tan(camera.fovY / 2) : 0;
  const horizontalHalfExtent = verticalHalfExtent * (camera.width / camera.height);
  const leftNdc = (bounds.left / camera.width) * 2 - 1;
  const rightNdc = (bounds.right / camera.width) * 2 - 1;
  const topNdc = 1 - (bounds.top / camera.height) * 2;
  const bottomNdc = 1 - (bounds.bottom / camera.height) * 2;

  const sidePlanes =
    camera.mode === "perspective"
      ? perspectiveSidePlanes(
          basis,
          leftNdc * horizontalHalfExtent,
          rightNdc * horizontalHalfExtent,
          topNdc * verticalHalfExtent,
          bottomNdc * verticalHalfExtent,
        )
      : orthographicSidePlanes(camera, basis, {
          left: leftNdc * horizontalHalfExtentFor(camera),
          right: rightNdc * horizontalHalfExtentFor(camera),
          top: topNdc * (camera.orthoHeight / 2),
          bottom: bottomNdc * (camera.orthoHeight / 2),
        });
  return {
    ...sidePlanes,
    near: plane(basis.forward, -dot(basis.forward, camera.position) - camera.near),
    far: plane(scale(basis.forward, -1), dot(basis.forward, camera.position) + camera.far),
  };
}

interface CameraBasis {
  readonly forward: Vec3;
  readonly right: Vec3;
  readonly up: Vec3;
  readonly position: Vec3;
}

interface RectBounds {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

interface OrthographicExtents {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

function cameraBasis(camera: Camera): CameraBasis {
  const view = viewMatrix(camera);
  return {
    forward: [-(view[2] ?? 0), -(view[6] ?? 0), -(view[10] ?? 0)],
    right: [view[0] ?? 0, view[4] ?? 0, view[8] ?? 0],
    up: [view[1] ?? 0, view[5] ?? 0, view[9] ?? 0],
    position: camera.position,
  };
}

function perspectiveSidePlanes(
  basis: CameraBasis,
  leftSlope: number,
  rightSlope: number,
  topSlope: number,
  bottomSlope: number,
): Pick<BoxSelectionFrustum, "left" | "right" | "top" | "bottom"> {
  return {
    left: planeFromCamera(basis, basis.right, leftSlope),
    right: planeFromCamera(basis, scale(basis.right, -1), -rightSlope),
    top: planeFromCamera(basis, scale(basis.up, -1), -topSlope),
    bottom: planeFromCamera(basis, basis.up, bottomSlope),
  };
}

function orthographicSidePlanes(
  camera: Camera,
  basis: CameraBasis,
  extents: OrthographicExtents,
): Pick<BoxSelectionFrustum, "left" | "right" | "top" | "bottom"> {
  return {
    left: plane(basis.right, -dot(basis.right, camera.position) - extents.left),
    right: plane(scale(basis.right, -1), dot(basis.right, camera.position) + extents.right),
    top: plane(scale(basis.up, -1), dot(basis.up, camera.position) + extents.top),
    bottom: plane(basis.up, -dot(basis.up, camera.position) - extents.bottom),
  };
}

function planeFromCamera(basis: CameraBasis, lateral: Vec3, forwardSlope: number): FrustumPlane {
  const normal = subtract(lateral, scale(basis.forward, forwardSlope));
  return plane(normal, -dot(normal, basis.position));
}

function plane(normal: Vec3, distance: number): FrustumPlane {
  const magnitude = length(normal);
  const unit = scale(normal, 1 / magnitude);
  return { normal: unit, distance: distance / Math.max(Number.EPSILON, magnitude) };
}

function horizontalHalfExtentFor(camera: Camera): number {
  return (camera.orthoHeight * camera.width) / camera.height / 2;
}

function clampedBounds(camera: Camera, rect: BoxSelectionRect): RectBounds {
  const values = [rect.left, rect.top, rect.right, rect.bottom, rect.width, rect.height];
  if (values.some((value) => !Number.isFinite(value))) {
    throw new TypeError("Box selection rectangle must contain finite values");
  }
  const left = clamp(Math.min(rect.left, rect.right), 0, camera.width);
  const right = clamp(Math.max(rect.left, rect.right), 0, camera.width);
  const top = clamp(Math.min(rect.top, rect.bottom), 0, camera.height);
  const bottom = clamp(Math.max(rect.top, rect.bottom), 0, camera.height);
  if (right <= left || bottom <= top) {
    throw new RangeError("Box selection rectangle must have positive area inside the camera");
  }
  return { left, top, right, bottom };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
