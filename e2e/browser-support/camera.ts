import { expect, type Locator } from "@playwright/test";

export interface CameraSnapshot {
  readonly mode: "perspective" | "orthographic";
  readonly position: readonly [number, number, number];
  readonly target: readonly [number, number, number];
  readonly up: readonly [number, number, number];
  readonly fovY: number;
  readonly orthoHeight: number;
  readonly width: number;
  readonly height: number;
  readonly near: number;
  readonly far: number;
}

export interface BoundsSnapshot {
  readonly minX: number;
  readonly minY: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly maxZ: number;
}

/** Reads the demo's current camera and the active scene navigation bounds. */
export async function readNavigationState(
  canvas: Locator,
): Promise<{ readonly camera: CameraSnapshot; readonly bounds: BoundsSnapshot }> {
  const camera = await canvas.getAttribute("data-camera");
  const bounds = await canvas.getAttribute("data-camera-bounds");
  if (camera === null || bounds === null) throw new Error("camera navigation metadata is missing");
  return {
    camera: JSON.parse(camera) as CameraSnapshot,
    bounds: JSON.parse(bounds) as BoundsSnapshot,
  };
}

/** Asserts the bounds/clip invariant exposed by the camera navigation contract. */
export function expectBoundsClippedSafely(camera: CameraSnapshot, bounds: BoundsSnapshot): void {
  const depths = boundsDepths(camera, bounds);
  expect(Math.min(...depths), "all model bounds must stay beyond the near plane").toBeGreaterThan(
    camera.near,
  );
  expect(Math.max(...depths), "the far plane must contain the model bounds").toBeLessThan(
    camera.far,
  );
}

/** Asserts the positive-depth clip interval and one displayed approach point. */
export function expectDisplayedPointClippedSafely(
  camera: CameraSnapshot,
  bounds: BoundsSnapshot,
  point: readonly [number, number, number],
): void {
  const depths = boundsDepths(camera, bounds).filter((depth) => depth > 0);
  expect(depths.length, "the camera must retain a positive scene depth").toBeGreaterThan(0);
  expect(
    Math.min(...depths),
    "positive scene depths must stay beyond the near plane",
  ).toBeGreaterThan(camera.near);
  expect(Math.max(...depths), "the far plane must contain positive scene depths").toBeLessThan(
    camera.far,
  );
  expect(
    pointDepth(camera, point),
    "the displayed approach point must stay beyond the near plane",
  ).toBeGreaterThan(camera.near);
}

/** Returns the eye-target distance from a captured camera snapshot. */
export function cameraDistance(camera: CameraSnapshot): number {
  return Math.hypot(
    camera.position[0] - camera.target[0],
    camera.position[1] - camera.target[1],
    camera.position[2] - camera.target[2],
  );
}

/** Computes the empty-space navigation point on the plane through the target. */
export function targetPlanePoint(
  camera: CameraSnapshot,
  x: number,
  y: number,
): readonly [number, number, number] {
  const forward = normalize(subtract(camera.target, camera.position));
  const right = normalize(cross(forward, camera.up));
  const up = cross(right, forward);
  const distance = dot(subtract(camera.target, camera.position), forward);
  const halfHeight =
    camera.mode === "orthographic" ? camera.orthoHeight / 2 : Math.tan(camera.fovY / 2) * distance;
  const halfWidth = halfHeight * (camera.width / camera.height);
  const ndcX = (x / camera.width) * 2 - 1;
  const ndcY = 1 - (y / camera.height) * 2;
  return add(
    add(add(camera.position, scale(forward, distance)), scale(right, ndcX * halfWidth)),
    scale(up, ndcY * halfHeight),
  );
}

/** Applies a CSS-pixel pan to a snapshot using the current target-plane scale. */
export function panCameraSnapshot(
  camera: CameraSnapshot,
  deltaX: number,
  deltaY: number,
): CameraSnapshot {
  const forward = normalize(subtract(camera.target, camera.position));
  const right = normalize(cross(forward, camera.up));
  const up = normalize(cross(right, forward));
  const worldUnitsPerPixel =
    camera.mode === "perspective"
      ? (2 * cameraDistance(camera) * Math.tan(camera.fovY / 2)) / camera.height
      : camera.orthoHeight / camera.height;
  const delta = add(
    scale(right, -deltaX * worldUnitsPerPixel),
    scale(up, deltaY * worldUnitsPerPixel),
  );
  return {
    ...camera,
    position: add(camera.position, delta),
    target: add(camera.target, delta),
  };
}

/** Projects a world point into the camera's CSS pixel coordinates. */
export function projectCameraPoint(
  camera: CameraSnapshot,
  point: readonly [number, number, number],
): readonly [number, number] | undefined {
  const forward = normalize(subtract(camera.target, camera.position));
  const right = normalize(cross(forward, camera.up));
  const up = cross(right, forward);
  const relative = subtract(point, camera.position);
  const depth = dot(relative, forward);
  if (depth <= 0) return undefined;
  const halfHeight =
    camera.mode === "orthographic" ? camera.orthoHeight / 2 : Math.tan(camera.fovY / 2) * depth;
  const halfWidth = halfHeight * (camera.width / camera.height);
  return [
    ((dot(relative, right) / halfWidth + 1) * camera.width) / 2,
    ((1 - dot(relative, up) / halfHeight) * camera.height) / 2,
  ];
}

function boundsDepths(camera: CameraSnapshot, bounds: BoundsSnapshot): readonly number[] {
  const forward = normalize([
    camera.target[0] - camera.position[0],
    camera.target[1] - camera.position[1],
    camera.target[2] - camera.position[2],
  ]);
  return boundsCorners(bounds).map((corner) =>
    dot(
      [
        corner[0] - camera.position[0],
        corner[1] - camera.position[1],
        corner[2] - camera.position[2],
      ],
      forward,
    ),
  );
}

function pointDepth(camera: CameraSnapshot, point: readonly [number, number, number]): number {
  const forward = normalize(subtract(camera.target, camera.position));
  return dot(subtract(point, camera.position), forward);
}

function boundsCorners(bounds: BoundsSnapshot): readonly (readonly [number, number, number])[] {
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

function dot(a: readonly number[], b: readonly number[]): number {
  return (a[0] ?? 0) * (b[0] ?? 0) + (a[1] ?? 0) * (b[1] ?? 0) + (a[2] ?? 0) * (b[2] ?? 0);
}

type Vec3 = readonly [number, number, number];

function add(a: readonly number[], b: readonly number[]): Vec3 {
  return [(a[0] ?? 0) + (b[0] ?? 0), (a[1] ?? 0) + (b[1] ?? 0), (a[2] ?? 0) + (b[2] ?? 0)];
}

function subtract(a: readonly number[], b: readonly number[]): Vec3 {
  return [(a[0] ?? 0) - (b[0] ?? 0), (a[1] ?? 0) - (b[1] ?? 0), (a[2] ?? 0) - (b[2] ?? 0)];
}

function scale(vector: readonly number[], amount: number): Vec3 {
  return [(vector[0] ?? 0) * amount, (vector[1] ?? 0) * amount, (vector[2] ?? 0) * amount];
}

function cross(a: readonly number[], b: readonly number[]): Vec3 {
  return [
    (a[1] ?? 0) * (b[2] ?? 0) - (a[2] ?? 0) * (b[1] ?? 0),
    (a[2] ?? 0) * (b[0] ?? 0) - (a[0] ?? 0) * (b[2] ?? 0),
    (a[0] ?? 0) * (b[1] ?? 0) - (a[1] ?? 0) * (b[0] ?? 0),
  ];
}

function normalize(vector: readonly number[]): Vec3 {
  const length = Math.hypot(vector[0] ?? 0, vector[1] ?? 0, vector[2] ?? 0);
  return [(vector[0] ?? 0) / length, (vector[1] ?? 0) / length, (vector[2] ?? 0) / length];
}
