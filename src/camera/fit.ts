import type { Bounds } from "../geometry/part";
import type { Camera, Vec3 } from "./camera";

/** Fraction of the viewport occupied by the fitted bounds on each axis. */
export const FIT_FRAME_FRACTION = 0.9;

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
  const distance = Math.max(
    vectorLength(subtract(camera.position, camera.target)),
    camera.near * 2,
    1,
  );
  const near = Math.min(camera.near, Math.max(0.0001, distance - Math.max(...depth) - 1));
  return {
    ...camera,
    position: subtract(center, scale(orientation.forward, distance)),
    target: center,
    up: orientation.up,
    near,
    far: Math.max(camera.far, distance + Math.max(...depth) + 1, near + 1),
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
  const distance = Math.max(requiredDistance, -Math.min(...depth) + 0.01, camera.near * 2, 0.01);
  const fittedDepth = depth.map((value) => value + distance);
  const near = Math.max(0.0001, Math.min(camera.near, Math.min(...fittedDepth) * 0.25));
  return {
    ...camera,
    position: subtract(center, scale(orientation.forward, distance)),
    target: center,
    up: orientation.up,
    near,
    far: Math.max(camera.far, Math.max(...fittedDepth) + near),
    width,
    height,
  };
}

function viewOrientation(camera: Camera): ViewOrientation {
  const forward = normalize(subtract(camera.target, camera.position), [0, 0, -1]);
  const right = normalize(cross(forward, camera.up), [1, 0, 0]);
  return { forward, right, up: normalize(cross(right, forward), [0, 1, 0]) };
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

function vectorLength(vector: Vec3): number {
  return Math.hypot(vector[0], vector[1], vector[2]);
}

function normalize(vector: Vec3, fallback: Vec3): Vec3 {
  const length = vectorLength(vector);
  return length > 1e-8 && Number.isFinite(length) ? scale(vector, 1 / length) : fallback;
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function subtract(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function scale(vector: Vec3, amount: number): Vec3 {
  return [vector[0] * amount, vector[1] * amount, vector[2] * amount];
}
