import { multiply, type Mat4 } from "../math/mat4";

/** A three-component vector used by camera state. */
export type Vec3 = readonly [number, number, number];

/** Supported camera projection modes. */
export type ProjectionMode = "perspective" | "orthographic";

/** Immutable orbit camera state. */
export interface Camera {
  readonly mode: ProjectionMode;
  readonly position: Vec3;
  readonly target: Vec3;
  readonly up: Vec3;
  readonly fovY: number;
  readonly near: number;
  readonly far: number;
  readonly orthoHeight: number;
  readonly width: number;
  readonly height: number;
}

/** Creates a camera with useful defaults for a model viewer. */
export function createCamera(options: Partial<Camera> = {}): Camera {
  return {
    mode: options.mode ?? "perspective",
    position: options.position ?? [3, 3, 5],
    target: options.target ?? [0, 0, 0],
    up: options.up ?? [0, 1, 0],
    fovY: options.fovY ?? Math.PI / 3,
    near: options.near ?? 0.01,
    far: options.far ?? 10_000,
    orthoHeight: options.orthoHeight ?? 6,
    width: options.width ?? 1,
    height: options.height ?? 1,
  };
}

/** Returns a copy resized to the viewport dimensions. */
export function resizeCamera(camera: Camera, width: number, height: number): Camera {
  return { ...camera, width: Math.max(1, width), height: Math.max(1, height) };
}

/** Changes projection mode without changing the orbit pose. */
export function setProjection(camera: Camera, mode: ProjectionMode): Camera {
  return camera.mode === mode ? camera : { ...camera, mode };
}

/** Orbits around the target in radians, clamping pitch before the poles. */
export function orbitCamera(camera: Camera, yawDelta: number, pitchDelta: number): Camera {
  const offset = subtract(camera.position, camera.target);
  const distance = length(offset);
  const yaw = Math.atan2(offset[0], offset[2]) + yawDelta;
  const pitch = clamp(
    Math.asin(offset[1] / distance) + pitchDelta,
    -Math.PI / 2 + 0.01,
    Math.PI / 2 - 0.01,
  );
  const horizontal = Math.cos(pitch) * distance;
  return {
    ...camera,
    position: [
      camera.target[0] + Math.sin(yaw) * horizontal,
      camera.target[1] + Math.sin(pitch) * distance,
      camera.target[2] + Math.cos(yaw) * horizontal,
    ],
  };
}

/** Pans the camera in view-plane world units. */
export function panCamera(camera: Camera, horizontal: number, vertical: number): Camera {
  const forward = normalize(subtract(camera.target, camera.position));
  const right = normalize(cross(forward, camera.up));
  const up = normalize(cross(right, forward));
  const delta = add(scale(right, -horizontal), scale(up, vertical));
  return { ...camera, position: add(camera.position, delta), target: add(camera.target, delta) };
}

/** Zooms toward the target while keeping near/far planes valid. */
export function zoomCamera(camera: Camera, amount: number): Camera {
  if (camera.mode === "orthographic") {
    return {
      ...camera,
      orthoHeight: clamp(camera.orthoHeight * Math.exp(amount), 0.01, camera.far),
    };
  }
  const offset = subtract(camera.position, camera.target);
  const distance = clamp(length(offset) * Math.exp(amount), camera.near * 2, camera.far / 2);
  return { ...camera, position: add(camera.target, scale(normalize(offset), distance)) };
}

/** Returns the column-major view matrix. */
export function viewMatrix(camera: Camera): Mat4 {
  const forward = normalize(subtract(camera.target, camera.position));
  const right = normalize(cross(forward, camera.up));
  const up = cross(right, forward);
  return new Float32Array([
    right[0],
    up[0],
    -forward[0],
    0,
    right[1],
    up[1],
    -forward[1],
    0,
    right[2],
    up[2],
    -forward[2],
    0,
    -dot(right, camera.position),
    -dot(up, camera.position),
    dot(forward, camera.position),
    1,
  ]);
}

/** Returns the column-major projection matrix. */
export function projectionMatrix(camera: Camera): Mat4 {
  const aspect = camera.width / camera.height;
  if (camera.mode === "orthographic") {
    const halfWidth = (camera.orthoHeight * aspect) / 2;
    const halfHeight = camera.orthoHeight / 2;
    return new Float32Array([
      1 / halfWidth,
      0,
      0,
      0,
      0,
      1 / halfHeight,
      0,
      0,
      0,
      0,
      -2 / (camera.far - camera.near),
      0,
      0,
      0,
      -(camera.far + camera.near) / (camera.far - camera.near),
      1,
    ]);
  }
  const f = 1 / Math.tan(camera.fovY / 2);
  return new Float32Array([
    f / aspect,
    0,
    0,
    0,
    0,
    f,
    0,
    0,
    0,
    0,
    (camera.far + camera.near) / (camera.near - camera.far),
    -1,
    0,
    0,
    (2 * camera.far * camera.near) / (camera.near - camera.far),
    0,
  ]);
}

/** Returns the matrix that maps world coordinates to clip coordinates. */
export function viewProjectionMatrix(camera: Camera): Mat4 {
  return multiply(projectionMatrix(camera), viewMatrix(camera));
}

/** Projects a world point into pixel coordinates, or returns undefined if invalid. */
export function projectPoint(
  camera: Camera,
  point: Vec3,
): readonly [number, number, number] | undefined {
  const clip = multiplyPoint(viewProjectionMatrix(camera), point);
  if (clip[3] <= 0) return undefined;
  return [
    ((clip[0] / clip[3] + 1) * camera.width) / 2,
    ((1 - clip[1] / clip[3]) * camera.height) / 2,
    clip[2] / clip[3],
  ];
}

function multiplyPoint(matrix: Mat4, point: Vec3): readonly [number, number, number, number] {
  return [
    entry(matrix, 0) * point[0] +
      entry(matrix, 4) * point[1] +
      entry(matrix, 8) * point[2] +
      entry(matrix, 12),
    entry(matrix, 1) * point[0] +
      entry(matrix, 5) * point[1] +
      entry(matrix, 9) * point[2] +
      entry(matrix, 13),
    entry(matrix, 2) * point[0] +
      entry(matrix, 6) * point[1] +
      entry(matrix, 10) * point[2] +
      entry(matrix, 14),
    entry(matrix, 3) * point[0] +
      entry(matrix, 7) * point[1] +
      entry(matrix, 11) * point[2] +
      entry(matrix, 15),
  ];
}

function entry(matrix: Mat4, index: number): number {
  return matrix[index] ?? 0;
}

function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function subtract(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function scale(vector: Vec3, amount: number): Vec3 {
  return [vector[0] * amount, vector[1] * amount, vector[2] * amount];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function length(vector: Vec3): number {
  return Math.hypot(vector[0], vector[1], vector[2]);
}

function normalize(vector: Vec3): Vec3 {
  const magnitude = length(vector);
  return magnitude === 0 ? [0, 0, 1] : scale(vector, 1 / magnitude);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
