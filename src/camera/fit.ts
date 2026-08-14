import { boundsCorners, type Bounds } from "../geometry/part";
import { add, cross, dot, length, normalize, scale, subtract, type Vec3 } from "../math/vec3";
import type { Camera } from "./camera";
import { cameraDepthMargin } from "./navigation";

/** Fraction of the viewport occupied by the fitted bounds on each axis. */
export const FIT_FRAME_FRACTION = 0.9;

/**
 * CSS-pixel occlusion to leave outside a fitted scene frame.
 * @category Camera and math
 */
export interface CameraContentInset {
  readonly top?: number;
  readonly right?: number;
  readonly bottom?: number;
  readonly left?: number;
}

/** Keeps fitted bounds strictly inside the configured clip interval. */
const FIT_POSITION_MARGIN = 0.01;
const FIT_MIN_NEAR = 0.0001;

/**
 * Frames bounds around their center while preserving the camera orientation.
 * @category Camera and math
 */
export function fitCamera(
  camera: Camera,
  bounds: Bounds,
  width: number,
  height: number,
  contentInset: CameraContentInset = {},
): Camera {
  const center: Vec3 = [
    midpoint(bounds.minX, bounds.maxX),
    midpoint(bounds.minY, bounds.maxY),
    midpoint(bounds.minZ, bounds.maxZ),
  ];
  const orientation = viewOrientation(camera);
  const corners = boundsCorners(bounds).map((corner) => subtract(corner, center));
  const dimensions = projectedDimensions(corners, orientation);
  const viewportWidth = Math.max(1, width);
  const viewportHeight = Math.max(1, height);
  const inset = normalizedInset(contentInset, viewportWidth, viewportHeight);
  const fitWidth = Math.max(1, viewportWidth - inset.left - inset.right);
  const fitHeight = Math.max(1, viewportHeight - inset.top - inset.bottom);
  const depth = projectedDepths(corners, orientation.forward);
  const inputs: FitInputs = {
    camera,
    center,
    bounds,
    orientation,
    corners,
    dimensions,
    depth,
    width: viewportWidth,
    height: viewportHeight,
    fitWidth,
    fitHeight,
    inset,
  };
  const fitted = camera.mode === "orthographic" ? fitOrthographic(inputs) : fitPerspective(inputs);
  return shiftToContentCenter(fitted, inset);
}

interface ViewOrientation {
  readonly forward: Vec3;
  readonly right: Vec3;
  readonly up: Vec3;
}

interface FitInputs {
  readonly camera: Camera;
  readonly center: Vec3;
  readonly bounds: Bounds;
  readonly orientation: ViewOrientation;
  readonly corners: readonly Vec3[];
  readonly dimensions: { readonly width: number; readonly height: number };
  readonly depth: readonly number[];
  readonly width: number;
  readonly height: number;
  readonly fitWidth: number;
  readonly fitHeight: number;
  readonly inset: Required<CameraContentInset>;
}

function fitOrthographic(inputs: FitInputs): Camera {
  const {
    camera,
    center,
    bounds,
    orientation,
    dimensions,
    depth,
    width,
    height,
    fitWidth,
    fitHeight,
  } = inputs;
  const orthoHeight = Math.max(
    0.001,
    (dimensions.height * height) / (fitHeight * FIT_FRAME_FRACTION),
    (dimensions.width * height) / (fitWidth * FIT_FRAME_FRACTION),
  );
  const orbitClearance =
    Math.hypot(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, bounds.maxZ - bounds.minZ) / 2;
  const distance = Math.max(
    -Math.min(...depth) + FIT_POSITION_MARGIN,
    orbitClearance + cameraDepthMargin(bounds),
    FIT_POSITION_MARGIN,
  );
  const fittedDepth = depth.map((value) => value + distance);
  const near = fittedNear(fittedDepth);
  return {
    ...camera,
    position: subtract(center, scale(orientation.forward, distance)),
    target: center,
    up: orientation.up,
    near,
    far: fittedFar(fittedDepth, near, cameraDepthMargin(bounds)),
    orthoHeight,
    width,
    height,
  };
}

function fitPerspective(inputs: FitInputs): Camera {
  const {
    camera,
    center,
    bounds,
    orientation,
    corners,
    depth,
    width,
    height,
    fitWidth,
    fitHeight,
  } = inputs;
  const tangent = Math.tan(clamp(camera.fovY, 0.01, Math.PI - 0.01) / 2);
  const requiredDistance = Math.max(
    ...corners.map((corner, index) => {
      const projectedDepth = depth[index] ?? 0;
      const horizontal = Math.abs(dot(corner, orientation.right));
      const vertical = Math.abs(dot(corner, orientation.up));
      return Math.max(
        (horizontal * height) / (tangent * fitWidth * FIT_FRAME_FRACTION) - projectedDepth,
        (vertical * height) / (tangent * fitHeight * FIT_FRAME_FRACTION) - projectedDepth,
      );
    }),
  );
  const distance = Math.max(
    requiredDistance,
    -Math.min(...depth) + FIT_POSITION_MARGIN,
    FIT_POSITION_MARGIN,
  );
  const fittedDepth = depth.map((value) => value + distance);
  const near = fittedNear(fittedDepth);
  return {
    ...camera,
    position: subtract(center, scale(orientation.forward, distance)),
    target: center,
    up: orientation.up,
    near,
    far: fittedFar(fittedDepth, near, cameraDepthMargin(bounds)),
    width,
    height,
  };
}

function fittedNear(depth: readonly number[]): number {
  return Math.max(FIT_MIN_NEAR, Math.min(...depth) * 0.25);
}

function fittedFar(depth: readonly number[], near: number, margin: number): number {
  const far = Math.max(...depth) + margin;
  return far > near ? far : near + margin;
}

function viewOrientation(camera: Camera): ViewOrientation {
  const forward = normalize(subtract(camera.target, camera.position), [0, 0, -1], 1e-8);
  const right = normalize(cross(forward, camera.up), [1, 0, 0], 1e-8);
  return { forward, right, up: normalize(cross(right, forward), [0, 1, 0], 1e-8) };
}

function projectedDimensions(corners: readonly Vec3[], orientation: ViewOrientation) {
  return {
    width:
      Math.max(...corners.map((corner) => dot(corner, orientation.right))) -
      Math.min(...corners.map((corner) => dot(corner, orientation.right))),
    height:
      Math.max(...corners.map((corner) => dot(corner, orientation.up))) -
      Math.min(...corners.map((corner) => dot(corner, orientation.up))),
  };
}

function projectedDepths(corners: readonly Vec3[], forward: Vec3): readonly number[] {
  return corners.map((corner) => dot(corner, forward));
}

function midpoint(min: number, max: number): number {
  return Number.isFinite(min) && Number.isFinite(max) ? (min + max) / 2 : 0;
}

function normalizedInset(
  inset: CameraContentInset,
  width: number,
  height: number,
): Required<CameraContentInset> {
  const normalized = {
    top: inset.top ?? 0,
    right: inset.right ?? 0,
    bottom: inset.bottom ?? 0,
    left: inset.left ?? 0,
  };
  for (const [name, value] of Object.entries(normalized)) {
    if (!Number.isFinite(value) || value < 0) {
      throw new RangeError(`Camera content inset ${name} must be finite and non-negative`);
    }
  }
  return {
    top: Math.min(normalized.top, height - 1),
    right: Math.min(normalized.right, width - 1),
    bottom: Math.min(normalized.bottom, height - 1),
    left: Math.min(normalized.left, width - 1),
  };
}

function shiftToContentCenter(camera: Camera, inset: Required<CameraContentInset>): Camera {
  if (inset.top === 0 && inset.right === 0 && inset.bottom === 0 && inset.left === 0) {
    return camera;
  }
  const forward = normalize(subtract(camera.target, camera.position));
  const right = normalize(cross(forward, camera.up));
  const up = cross(right, forward);
  const pixelsPerWorldUnit =
    camera.mode === "orthographic"
      ? camera.height / camera.orthoHeight
      : camera.height /
        (2 * Math.tan(camera.fovY / 2)) /
        length(subtract(camera.position, camera.target));
  const screenDeltaX = (inset.left - inset.right) / 2;
  const screenDeltaY = (inset.top - inset.bottom) / 2;
  const delta = add(
    scale(right, -screenDeltaX / pixelsPerWorldUnit),
    scale(up, screenDeltaY / pixelsPerWorldUnit),
  );
  return {
    ...camera,
    position: add(camera.position, delta),
    target: add(camera.target, delta),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}
