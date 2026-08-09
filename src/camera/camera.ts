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

/** Changes projection mode while keeping the current vertical framing. */
export function setProjection(camera: Camera, mode: ProjectionMode): Camera {
  if (camera.mode === mode) return camera;
  if (mode === "orthographic") {
    const distance = length(subtract(camera.position, camera.target));
    return {
      ...camera,
      mode,
      orthoHeight: clamp(distance * 2 * Math.tan(camera.fovY / 2), 0.01, camera.far),
    };
  }
  const distance = clamp(
    camera.orthoHeight / (2 * Math.tan(camera.fovY / 2)),
    camera.near * 2,
    camera.far / 2,
  );
  const offset = normalize(subtract(camera.position, camera.target));
  return {
    ...camera,
    mode,
    position: add(camera.target, scale(offset, distance)),
  };
}

/**
 * Orbits in radians around the target, or around an explicit world-space
 * pivot. Rotation is continuous through the poles instead of clamping pitch.
 */
export function orbitCamera(
  camera: Camera,
  yawDelta: number,
  pitchDelta: number,
  pivot?: Vec3,
): Camera {
  return orbitAroundPivot(camera, yawDelta, pitchDelta, pivot ?? camera.target);
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
      orthoHeight: clamp(camera.orthoHeight * Math.exp(amount), 0.000001, camera.far),
    };
  }
  const offset = subtract(camera.position, camera.target);
  const distance = clamp(length(offset) * Math.exp(amount), 0.000001, camera.far / 2);
  return {
    ...camera,
    near: Math.min(camera.near, distance / 1000),
    position: add(camera.target, scale(normalize(offset), distance)),
  };
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

/**
 * Returns the column-major projection matrix.
 * Assumes a right-handed view space with a -Z forward axis. Depth maps to
 * `[0, 1]` to match the WebGPU clip-space convention: a point at the near
 * plane gets `clip.z = 0` and a point at the far plane gets `clip.z = w`.
 */
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
      -1 / (camera.far - camera.near),
      0,
      0,
      0,
      -camera.near / (camera.far - camera.near),
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
    camera.far / (camera.near - camera.far),
    -1,
    0,
    0,
    (camera.far * camera.near) / (camera.near - camera.far),
    0,
  ]);
}

/** Returns the matrix that maps world coordinates to clip coordinates. */
export function viewProjectionMatrix(camera: Camera): Mat4 {
  return multiply(projectionMatrix(camera), viewMatrix(camera));
}

/**
 * Projects a world point into pixel coordinates, or returns undefined if the
 * point is at or behind the camera. The third component is the NDC depth, in
 * the `[0, 1]` convention used by the projection matrix.
 */
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

/**
 * Unprojects a camera-pixel position and WebGPU NDC depth into world space.
 * `point[0..1]` use the camera's top-left pixel coordinates and `point[2]`
 * uses WebGPU's `[0, 1]` depth convention.
 */
export function unprojectPoint(camera: Camera, point: Vec3): Vec3 {
  const ndcX = (point[0] / camera.width) * 2 - 1;
  const ndcY = 1 - (point[1] / camera.height) * 2;
  const forward = normalize(subtract(camera.target, camera.position));
  const right = normalize(cross(forward, camera.up));
  const up = cross(right, forward);
  if (camera.mode === "orthographic") {
    const distance = camera.near + point[2] * (camera.far - camera.near);
    const halfHeight = camera.orthoHeight / 2;
    const halfWidth = halfHeight * (camera.width / camera.height);
    return add(
      add(add(camera.position, scale(forward, distance)), scale(right, ndcX * halfWidth)),
      scale(up, ndcY * halfHeight),
    );
  }
  const distance =
    (camera.near * camera.far) / (camera.far - point[2] * (camera.far - camera.near));
  const halfHeight = Math.tan(camera.fovY / 2) * distance;
  const halfWidth = halfHeight * (camera.width / camera.height);
  return add(
    add(add(camera.position, scale(forward, distance)), scale(right, ndcX * halfWidth)),
    scale(up, ndcY * halfHeight),
  );
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

/** Rotates both eye and look target around a picked point without an initial jump. */
function orbitAroundPivot(camera: Camera, yaw: number, pitch: number, pivot: Vec3): Camera {
  const yawedPosition = rotateAround(camera.position, pivot, camera.up, yaw);
  const yawedTarget = rotateAround(camera.target, pivot, camera.up, yaw);
  const forward = normalize(subtract(yawedTarget, yawedPosition));
  const right = normalize(cross(forward, camera.up));
  return {
    ...camera,
    position: rotateAround(yawedPosition, pivot, right, pitch),
    target: rotateAround(yawedTarget, pivot, right, pitch),
  };
}

/** Rodrigues rotation of a point around an axis through a pivot. */
function rotateAround(point: Vec3, pivot: Vec3, axis: Vec3, angle: number): Vec3 {
  const vector = subtract(point, pivot);
  const unitAxis = normalize(axis);
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const rotated = add(
    add(scale(vector, cosine), scale(cross(unitAxis, vector), sine)),
    scale(unitAxis, dot(unitAxis, vector) * (1 - cosine)),
  );
  return add(pivot, rotated);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
