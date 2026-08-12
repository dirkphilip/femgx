import { multiply, transformPoint4, type Mat4 } from "../math/mat4";
import { add, cross, dot, length, normalize, scale, subtract, type Vec3 } from "../math/vec3";

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

const CAMERA_EPSILON = 1e-8;

/** Validates a complete camera at an ownership boundary. */
export function assertValidCamera(camera: Camera): void {
  assertProjectionMode(camera.mode);
  assertFiniteVector("position", camera.position);
  assertFiniteVector("target", camera.target);
  assertFiniteVector("up", camera.up);
  const view = subtract(camera.target, camera.position);
  const viewLength = length(view);
  const upLength = length(camera.up);
  if (!Number.isFinite(viewLength) || !Number.isFinite(upLength)) {
    throw new Error("Camera view basis must have finite length");
  }
  if (viewLength <= CAMERA_EPSILON) {
    throw new Error("Camera position and target must be distinct");
  }
  if (upLength <= CAMERA_EPSILON) {
    throw new Error("Camera up must have non-zero length");
  }
  const normalizedView = scale(view, 1 / viewLength);
  const normalizedUp = scale(camera.up, 1 / upLength);
  if (length(cross(normalizedView, normalizedUp)) <= CAMERA_EPSILON) {
    throw new Error("Camera up must not be parallel to the view direction");
  }
  assertFiniteNumber("fovY", camera.fovY);
  if (camera.fovY <= 0 || camera.fovY >= Math.PI) {
    throw new Error("Camera fovY must be strictly between 0 and Math.PI");
  }
  assertFiniteNumber("near", camera.near);
  assertFiniteNumber("far", camera.far);
  if (camera.near <= 0 || camera.near >= camera.far) {
    throw new Error("Camera near/far must satisfy 0 < near < far");
  }
  assertFiniteNumber("orthoHeight", camera.orthoHeight);
  if (camera.orthoHeight <= 0) throw new Error("Camera orthoHeight must be greater than zero");
  assertFiniteNumber("width", camera.width);
  assertFiniteNumber("height", camera.height);
  if (camera.width < 1 || camera.height < 1) {
    throw new Error("Camera width and height must be at least 1");
  }
}

/** Creates an orthographic camera by default; pass `mode: "perspective"` to opt into perspective. */
export function createCamera(options: Partial<Camera> = {}): Camera {
  const camera = {
    mode: options.mode ?? "orthographic",
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
  assertValidCamera(camera);
  return camera;
}

/** Returns a copy resized to finite viewport dimensions; small sizes normalize to 1. */
export function resizeCamera(camera: Camera, width: number, height: number): Camera {
  assertFiniteNumber("width", width);
  assertFiniteNumber("height", height);
  return { ...camera, width: Math.max(1, width), height: Math.max(1, height) };
}

/** Changes projection mode while keeping the current vertical framing. */
export function setProjection(camera: Camera, mode: ProjectionMode): Camera {
  assertProjectionMode(mode);
  if (camera.mode === mode) return camera;
  if (mode === "orthographic") {
    const distance = length(subtract(camera.position, camera.target));
    return {
      ...camera,
      mode,
      orthoHeight: Math.max(distance * 2 * Math.tan(camera.fovY / 2), 0.000001),
    };
  }
  const distance = Math.max(camera.orthoHeight / (2 * Math.tan(camera.fovY / 2)), 0.000001);
  const offset = normalize(subtract(camera.position, camera.target));
  return {
    ...camera,
    mode,
    position: add(camera.target, scale(offset, distance)),
  };
}

/**
 * Orbits in radians around the target, or around an explicit world-space
 * pivot. The complete camera frame rotates together, including `up`, so
 * pitch remains continuous through both poles and full revolutions.
 */
export function orbitCamera(
  camera: Camera,
  yawDelta: number,
  pitchDelta: number,
  pivot?: Vec3,
): Camera {
  assertFiniteNumber("orbit yaw", yawDelta);
  assertFiniteNumber("orbit pitch", pitchDelta);
  if (pivot !== undefined) assertFiniteVector("orbit pivot", pivot);
  if (yawDelta === 0 && pitchDelta === 0) return camera;
  return orbitAroundPivot(camera, yawDelta, pitchDelta, pivot ?? camera.target);
}

/** Pans the camera in view-plane world units. */
export function panCamera(camera: Camera, horizontal: number, vertical: number): Camera {
  assertFiniteNumber("pan horizontal", horizontal);
  assertFiniteNumber("pan vertical", vertical);
  const forward = normalize(subtract(camera.target, camera.position));
  const right = normalize(cross(forward, camera.up));
  const up = normalize(cross(right, forward));
  const delta = add(scale(right, -horizontal), scale(up, vertical));
  return { ...camera, position: add(camera.position, delta), target: add(camera.target, delta) };
}

/** Zooms toward the target while preserving the configured clip planes. */
export function zoomCamera(camera: Camera, amount: number): Camera {
  assertFiniteNumber("zoom amount", amount);
  if (camera.mode === "orthographic") {
    return {
      ...camera,
      orthoHeight: Math.max(camera.orthoHeight * Math.exp(amount), 0.000001),
    };
  }
  const offset = subtract(camera.position, camera.target);
  const distance = length(offset) * Math.exp(amount);
  return {
    ...camera,
    position: add(camera.target, scale(normalize(offset), distance)),
  };
}

/** Zooms around a world-space point while keeping that point under the cursor. */
export function zoomCameraAtPoint(camera: Camera, amount: number, pivot: Vec3): Camera {
  assertFiniteNumber("zoom amount", amount);
  assertFiniteVector("zoom pivot", pivot);
  const factor = Math.exp(amount);
  if (camera.mode === "orthographic") {
    const position = add(pivot, scale(subtract(camera.position, pivot), factor));
    const target = add(pivot, scale(subtract(camera.target, pivot), factor));
    return {
      ...camera,
      position,
      target,
      orthoHeight: Math.max(camera.orthoHeight * factor, 0.000001),
    };
  }
  const appliedFactor = factor;
  const position = add(pivot, scale(subtract(camera.position, pivot), appliedFactor));
  const target = add(pivot, scale(subtract(camera.target, pivot), appliedFactor));
  return {
    ...camera,
    position,
    target,
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
  const clip = transformPoint4(viewProjectionMatrix(camera), point[0], point[1], point[2]);
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

function assertFiniteNumber(name: string, value: number): void {
  if (!Number.isFinite(value)) throw new Error(`Camera ${name} must be finite`);
}

function assertFiniteVector(name: string, value: Vec3): void {
  const components = value as readonly number[];
  if (components.length !== 3 || components.some((component) => !Number.isFinite(component))) {
    throw new Error(`Camera ${name} must contain three finite components`);
  }
}

function assertProjectionMode(value: unknown): asserts value is ProjectionMode {
  if (value !== "perspective" && value !== "orthographic") {
    throw new Error(`Camera mode must be "perspective" or "orthographic"`);
  }
}

/** Rotates both eye and look target around a picked point without an initial jump. */
function orbitAroundPivot(camera: Camera, yaw: number, pitch: number, pivot: Vec3): Camera {
  const initialForward = normalize(subtract(camera.target, camera.position));
  const initialRight = normalize(cross(initialForward, normalize(camera.up)));
  const initialUp = normalize(cross(initialRight, initialForward));
  const yawedPosition = rotateAround(camera.position, pivot, initialUp, yaw);
  const yawedTarget = rotateAround(camera.target, pivot, initialUp, yaw);
  const yawedUp = initialUp;
  const forward = normalize(subtract(yawedTarget, yawedPosition));
  const right = normalize(cross(forward, yawedUp));
  return {
    ...camera,
    position: rotateAround(yawedPosition, pivot, right, pitch),
    target: rotateAround(yawedTarget, pivot, right, pitch),
    up: normalize(rotateDirection(yawedUp, right, pitch)),
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

/** Rodrigues rotation of a direction around an axis through the origin. */
function rotateDirection(direction: Vec3, axis: Vec3, angle: number): Vec3 {
  return rotateAround(direction, [0, 0, 0], axis, angle);
}
