import type { Bounds } from "../geometry/part";
import { cross, dot, normalize, scale, subtract, type Vec3 } from "../math/vec3";
import type { Camera } from "./camera";

/** Fraction of the viewport occupied by the fitted bounds on each axis. */
export const FIT_FRAME_FRACTION = 0.9;

/** Keeps fitted bounds strictly inside the configured clip interval. */
const FIT_DEPTH_MARGIN = 0.01;
const FIT_MIN_NEAR = 0.0001;

/** Frames bounds around their center while preserving the camera orientation. */
export function fitCamera(camera: Camera, bounds: Bounds, width: number, height: number): Camera {
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
  const aspect = viewportWidth / viewportHeight;
  const depth = projectedDepths(corners, orientation.forward);
  const inputs: FitInputs = {
    camera,
    center,
    orientation,
    corners,
    dimensions,
    depth,
    width: viewportWidth,
    height: viewportHeight,
    aspect,
  };
  return camera.mode === "orthographic" ? fitOrthographic(inputs) : fitPerspective(inputs);
}

interface ViewOrientation {
  readonly forward: Vec3;
  readonly right: Vec3;
  readonly up: Vec3;
}

interface FitInputs {
  readonly camera: Camera;
  readonly center: Vec3;
  readonly orientation: ViewOrientation;
  readonly corners: readonly Vec3[];
  readonly dimensions: { readonly width: number; readonly height: number };
  readonly depth: readonly number[];
  readonly width: number;
  readonly height: number;
  readonly aspect: number;
}

function fitOrthographic(inputs: FitInputs): Camera {
  const { camera, center, orientation, dimensions, depth, width, height, aspect } = inputs;
  const orthoHeight = Math.max(
    0.001,
    dimensions.height / FIT_FRAME_FRACTION,
    dimensions.width / (aspect * FIT_FRAME_FRACTION),
  );
  const distance = Math.max(-Math.min(...depth) + FIT_DEPTH_MARGIN, FIT_DEPTH_MARGIN);
  const fittedDepth = depth.map((value) => value + distance);
  const near = fittedNear(fittedDepth);
  return {
    ...camera,
    position: subtract(center, scale(orientation.forward, distance)),
    target: center,
    up: orientation.up,
    near,
    far: fittedFar(fittedDepth, near),
    orthoHeight,
    width,
    height,
  };
}

function fitPerspective(inputs: FitInputs): Camera {
  const { camera, center, orientation, corners, depth, width, height, aspect } = inputs;
  const tangent = Math.tan(clamp(camera.fovY, 0.01, Math.PI - 0.01) / 2);
  const requiredDistance = Math.max(
    ...corners.map((corner, index) => {
      const projectedDepth = depth[index] ?? 0;
      const horizontal = Math.abs(dot(corner, orientation.right));
      const vertical = Math.abs(dot(corner, orientation.up));
      return Math.max(
        horizontal / (tangent * aspect * FIT_FRAME_FRACTION) - projectedDepth,
        vertical / (tangent * FIT_FRAME_FRACTION) - projectedDepth,
      );
    }),
  );
  const distance = Math.max(
    requiredDistance,
    -Math.min(...depth) + FIT_DEPTH_MARGIN,
    FIT_DEPTH_MARGIN,
  );
  const fittedDepth = depth.map((value) => value + distance);
  const near = fittedNear(fittedDepth);
  return {
    ...camera,
    position: subtract(center, scale(orientation.forward, distance)),
    target: center,
    up: orientation.up,
    near,
    far: fittedFar(fittedDepth, near),
    width,
    height,
  };
}

function fittedNear(depth: readonly number[]): number {
  return Math.max(FIT_MIN_NEAR, Math.min(...depth) * 0.25);
}

function fittedFar(depth: readonly number[], near: number): number {
  const far = Math.max(...depth) + FIT_DEPTH_MARGIN;
  return far > near ? far : near + FIT_DEPTH_MARGIN;
}

function viewOrientation(camera: Camera): ViewOrientation {
  const forward = normalize(subtract(camera.target, camera.position), [0, 0, -1], 1e-8);
  const right = normalize(cross(forward, camera.up), [1, 0, 0], 1e-8);
  return { forward, right, up: normalize(cross(right, forward), [0, 1, 0], 1e-8) };
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}
