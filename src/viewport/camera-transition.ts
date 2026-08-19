import { assertValidCamera, type Camera } from "../camera/camera";
import { add, cross, length, normalize, scale, subtract, type Vec3 } from "../math/vec3";

export type CameraTransitionUpdate = (camera: Camera, complete: boolean) => void;
export type CameraTransitionInterpolator = (
  initial: Camera,
  target: Camera,
  amount: number,
) => Camera;

export interface CameraTransitionClock {
  readonly schedule: (callback: (time: number) => void) => number;
  readonly cancel: (handle: number) => void;
}

interface ActiveTransition {
  readonly initial: Camera;
  readonly target: Camera;
  readonly durationMs: number;
  readonly update: CameraTransitionUpdate;
  readonly interpolate: CameraTransitionInterpolator;
  startTime: number | undefined;
  frame: number | undefined;
}

/** Creates the internal scheduler used by viewport camera transitions. */
export function createCameraTransition(
  clock: CameraTransitionClock | undefined = browserClock(),
): CameraTransition {
  return new CameraTransition(clock);
}

/** Runs one cancellable camera transition against an injected frame clock. */
export class CameraTransition {
  private active: ActiveTransition | undefined;

  constructor(private readonly clock: CameraTransitionClock | undefined) {}

  start(
    initial: Camera,
    target: Camera,
    durationMs: number,
    update: CameraTransitionUpdate,
    interpolate: CameraTransitionInterpolator = interpolateCamera,
  ): void {
    assertValidCamera(initial);
    assertValidCamera(target);
    this.cancel();
    if (this.clock === undefined || durationMs === 0) {
      update(target, true);
      return;
    }
    const active: ActiveTransition = {
      initial,
      target,
      durationMs,
      update,
      interpolate,
      startTime: undefined,
      frame: undefined,
    };
    this.active = active;
    active.frame = this.clock.schedule((time) => {
      this.tick(active, time);
    });
  }

  cancel(): void {
    const active = this.active;
    if (active?.frame !== undefined) this.clock?.cancel(active.frame);
    this.active = undefined;
  }

  private tick(active: ActiveTransition, time: number): void {
    if (this.active !== active) return;
    active.startTime ??= time;
    const elapsed = Math.max(0, time - active.startTime);
    const linear = Math.min(1, elapsed / active.durationMs);
    const complete = linear >= 1;
    active.update(
      complete
        ? active.target
        : active.interpolate(active.initial, active.target, easeOutCubic(linear)),
      complete,
    );
    if (complete) {
      this.active = undefined;
      return;
    }
    active.frame = this.clock?.schedule((nextTime) => {
      this.tick(active, nextTime);
    });
  }
}

/** Interpolates camera scalars and vectors for one deterministic animation step. */
export function interpolateCamera(initial: Camera, target: Camera, amount: number): Camera {
  const position = interpolateVector(initial.position, target.position, amount);
  const nextTarget = interpolateVector(initial.target, target.target, amount);
  const view = subtract(nextTarget, position);
  const safeView = length(view) > 1e-8 ? view : subtract(target.target, target.position);
  const up = normalize(
    interpolateVector(initial.up, target.up, amount),
    normalize(target.up, [0, 1, 0]),
  );
  const correctedUp = safeUp(safeView, up, target.up, initial.up);
  return {
    ...target,
    position: length(view) > 1e-8 ? position : subtract(nextTarget, scale(normalize(safeView), 1)),
    target: nextTarget,
    up: correctedUp,
    fovY: interpolate(initial.fovY, target.fovY, amount),
    near: interpolate(initial.near, target.near, amount),
    far: interpolate(initial.far, target.far, amount),
    orthoHeight: interpolate(initial.orthoHeight, target.orthoHeight, amount),
    width: interpolate(initial.width, target.width, amount),
    height: interpolate(initial.height, target.height, amount),
  };
}

/** Interpolates a camera transition along a shortest spherical eye path. */
export function interpolateOrientationCamera(
  initial: Camera,
  target: Camera,
  amount: number,
): Camera {
  const nextTarget = interpolateVector(initial.target, target.target, amount);
  const initialOffset = subtract(initial.position, initial.target);
  const targetOffset = subtract(target.position, target.target);
  const orientation = interpolateQuaternion(
    cameraOrientation(initial),
    cameraOrientation(target),
    amount,
  );
  const backward = rotateQuaternion(orientation, [0, 0, 1]);
  const distance = interpolate(length(initialOffset), length(targetOffset), amount);
  const position = add(nextTarget, scale(backward, distance));
  const up = rotateQuaternion(orientation, [0, 1, 0]);
  return {
    ...target,
    position,
    target: nextTarget,
    up,
    fovY: interpolate(initial.fovY, target.fovY, amount),
    near: interpolate(initial.near, target.near, amount),
    far: interpolate(initial.far, target.far, amount),
    orthoHeight: interpolate(initial.orthoHeight, target.orthoHeight, amount),
    width: interpolate(initial.width, target.width, amount),
    height: interpolate(initial.height, target.height, amount),
  };
}

function browserClock(): CameraTransitionClock | undefined {
  if (typeof requestAnimationFrame === "undefined") return undefined;
  return {
    schedule: (callback) => requestAnimationFrame(callback),
    cancel: (handle) => {
      cancelAnimationFrame(handle);
    },
  };
}

function interpolateVector(initial: Vec3, target: Vec3, amount: number): Vec3 {
  return [
    interpolate(initial[0], target[0], amount),
    interpolate(initial[1], target[1], amount),
    interpolate(initial[2], target[2], amount),
  ];
}

interface Quaternion {
  readonly w: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

function cameraOrientation(camera: Camera): Quaternion {
  const forward = normalize(subtract(camera.target, camera.position));
  const right = normalize(cross(forward, camera.up));
  const up = normalize(cross(right, forward));
  return quaternionFromBasis(right, up, scale(forward, -1));
}

function quaternionFromBasis(right: Vec3, up: Vec3, backward: Vec3): Quaternion {
  const diagonal = right[0] + up[1] + backward[2];
  if (diagonal > 0) {
    const scaleFactor = Math.sqrt(diagonal + 1) * 2;
    return normalizeQuaternion({
      w: 0.25 * scaleFactor,
      x: (up[2] - backward[1]) / scaleFactor,
      y: (backward[0] - right[2]) / scaleFactor,
      z: (right[1] - up[0]) / scaleFactor,
    });
  }
  if (right[0] > up[1] && right[0] > backward[2]) {
    const scaleFactor = Math.sqrt(1 + right[0] - up[1] - backward[2]) * 2;
    return normalizeQuaternion({
      w: (up[2] - backward[1]) / scaleFactor,
      x: 0.25 * scaleFactor,
      y: (up[0] + right[1]) / scaleFactor,
      z: (backward[0] + right[2]) / scaleFactor,
    });
  }
  if (up[1] > backward[2]) {
    const scaleFactor = Math.sqrt(1 + up[1] - right[0] - backward[2]) * 2;
    return normalizeQuaternion({
      w: (backward[0] - right[2]) / scaleFactor,
      x: (up[0] + right[1]) / scaleFactor,
      y: 0.25 * scaleFactor,
      z: (backward[1] + up[2]) / scaleFactor,
    });
  }
  const scaleFactor = Math.sqrt(1 + backward[2] - right[0] - up[1]) * 2;
  return normalizeQuaternion({
    w: (right[1] - up[0]) / scaleFactor,
    x: (backward[0] + right[2]) / scaleFactor,
    y: (backward[1] + up[2]) / scaleFactor,
    z: 0.25 * scaleFactor,
  });
}

function interpolateQuaternion(
  initial: Quaternion,
  target: Quaternion,
  amount: number,
): Quaternion {
  let second = target;
  let cosine = quaternionDot(initial, target);
  if (cosine < 0) {
    second = negateQuaternion(target);
    cosine = -cosine;
  }
  if (cosine > 0.9995) return normalizeQuaternion(lerpQuaternion(initial, second, amount));
  const angle = Math.acos(Math.min(1, cosine));
  const sine = Math.sin(angle);
  return normalizeQuaternion({
    w: (Math.sin((1 - amount) * angle) * initial.w + Math.sin(amount * angle) * second.w) / sine,
    x: (Math.sin((1 - amount) * angle) * initial.x + Math.sin(amount * angle) * second.x) / sine,
    y: (Math.sin((1 - amount) * angle) * initial.y + Math.sin(amount * angle) * second.y) / sine,
    z: (Math.sin((1 - amount) * angle) * initial.z + Math.sin(amount * angle) * second.z) / sine,
  });
}

function rotateQuaternion(quaternion: Quaternion, value: Vec3): Vec3 {
  const vector: Vec3 = [quaternion.x, quaternion.y, quaternion.z];
  const twiceCross = scale(cross(vector, value), 2);
  return normalize(add(value, add(scale(twiceCross, quaternion.w), cross(vector, twiceCross))));
}

function lerpQuaternion(initial: Quaternion, target: Quaternion, amount: number): Quaternion {
  return {
    w: interpolate(initial.w, target.w, amount),
    x: interpolate(initial.x, target.x, amount),
    y: interpolate(initial.y, target.y, amount),
    z: interpolate(initial.z, target.z, amount),
  };
}

function quaternionDot(initial: Quaternion, target: Quaternion): number {
  return initial.w * target.w + initial.x * target.x + initial.y * target.y + initial.z * target.z;
}

function negateQuaternion(quaternion: Quaternion): Quaternion {
  return { w: -quaternion.w, x: -quaternion.x, y: -quaternion.y, z: -quaternion.z };
}

function normalizeQuaternion(quaternion: Quaternion): Quaternion {
  const magnitude = Math.hypot(quaternion.w, quaternion.x, quaternion.y, quaternion.z);
  return {
    w: quaternion.w / magnitude,
    x: quaternion.x / magnitude,
    y: quaternion.y / magnitude,
    z: quaternion.z / magnitude,
  };
}

function interpolate(initial: number, target: number, amount: number): number {
  return initial + (target - initial) * amount;
}

function easeOutCubic(amount: number): number {
  return 1 - (1 - amount) ** 3;
}

function isParallel(first: Vec3, second: Vec3): boolean {
  return length(cross(first, second)) <= 1e-8;
}

function safeUp(view: Vec3, candidate: Vec3, first: Vec3, second: Vec3): Vec3 {
  if (!isParallel(view, candidate)) return candidate;
  if (!isParallel(view, first)) return first;
  if (!isParallel(view, second)) return second;
  const axis: Vec3 = Math.abs(view[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  return normalize(cross(view, axis), [0, 0, 1]);
}
