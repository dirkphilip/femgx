import { describe, expect, it } from "vitest";
import { createCamera, projectPoint } from "../../src/camera/camera";
import {
  VIEW_CUBE_CORNERS,
  VIEW_CUBE_FACES,
  applyViewCubeAction,
  cornerDirection,
  rotateCameraByStep,
  snapCameraToDirection,
} from "../../src/camera/view-cube";
import {
  add,
  cross,
  dot,
  length,
  normalize,
  scale,
  subtract,
  type Vec3,
} from "../../src/math/vec3";

const bounds = {
  minX: -2,
  minY: -2,
  minZ: -2,
  maxX: 2,
  maxY: 2,
  maxZ: 2,
} as const;

function eyeDirection(camera: ReturnType<typeof createCamera>): Vec3 {
  return normalize(subtract(camera.position, camera.target));
}

function expectCameraBasis(camera: ReturnType<typeof createCamera>): void {
  const forward = normalize(subtract(camera.target, camera.position));
  expect(length(camera.up)).toBeCloseTo(1, 8);
  expect(dot(forward, camera.up)).toBeCloseTo(0, 8);
  expect(camera.position.every(Number.isFinite)).toBe(true);
  expect(camera.up.every(Number.isFinite)).toBe(true);
  expect(camera.near).toBeGreaterThan(0);
  expect(camera.far).toBeGreaterThan(camera.near);
}

function effectiveUp(camera: ReturnType<typeof createCamera>): Vec3 {
  const forward = normalize(subtract(camera.target, camera.position));
  const right = normalize(cross(forward, camera.up));
  return normalize(cross(right, forward));
}

describe("view-cube camera actions", () => {
  it("maps each signed face to its world-coordinate plane", () => {
    expect(VIEW_CUBE_FACES.map((face) => face.plane)).toEqual(["XY", "XY", "YZ", "YZ", "XZ", "XZ"]);
  });

  it("snaps all six faces with the documented signed directions", () => {
    const initial = createCamera({ position: [4, 3, 6], target: [0.5, -0.25, 0.75] });
    const distance = length(subtract(initial.position, initial.target));

    for (const face of VIEW_CUBE_FACES) {
      const snapped = snapCameraToDirection(initial, bounds, face.direction);
      expect(eyeDirection(snapped)[0]).toBeCloseTo(face.direction[0], 8);
      expect(eyeDirection(snapped)[1]).toBeCloseTo(face.direction[1], 8);
      expect(eyeDirection(snapped)[2]).toBeCloseTo(face.direction[2], 8);
      expect(snapped.target).toEqual(initial.target);
      expect(length(subtract(snapped.position, snapped.target))).toBeCloseTo(distance, 8);
      expectCameraBasis(snapped);
    }
  });

  it("snaps all eight corners to equal signed diagonals", () => {
    const initial = createCamera({ position: [4, 3, 6] });
    for (const corner of VIEW_CUBE_CORNERS) {
      const direction = cornerDirection(corner);
      const snapped = snapCameraToDirection(initial, bounds, direction);
      expect(eyeDirection(snapped)[0]).toBeCloseTo(direction[0], 8);
      expect(eyeDirection(snapped)[1]).toBeCloseTo(direction[1], 8);
      expect(eyeDirection(snapped)[2]).toBeCloseTo(direction[2], 8);
      expect(Math.abs(direction[0])).toBeCloseTo(Math.abs(direction[1]), 8);
      expect(Math.abs(direction[1])).toBeCloseTo(Math.abs(direction[2]), 8);
      expectCameraBasis(snapped);
    }
  });

  it("moves only outward when an exact perspective pose would clip", () => {
    const initial = createCamera({
      mode: "perspective",
      position: [0, 0, 1],
      target: [0, 0, 0],
      far: 100,
    });
    const snapped = snapCameraToDirection(initial, bounds, [0, 0, 1]);
    expect(eyeDirection(snapped)).toEqual([0, 0, 1]);
    expect(snapped.position[2]).toBeGreaterThan(2);
    expect(snapped.target).toEqual(initial.target);
    expect(snapped.mode).toBe(initial.mode);
  });

  it("preserves orthographic framing and target across snaps", () => {
    const initial = createCamera({
      mode: "orthographic",
      position: [4, 3, 6],
      target: [1, 2, 3],
      orthoHeight: 9,
    });
    const snapped = applyViewCubeAction(initial, bounds, { kind: "face", face: "top" });
    expect(snapped.mode).toBe("orthographic");
    expect(snapped.orthoHeight).toBe(initial.orthoHeight);
    expect(snapped.target).toEqual(initial.target);
    expectCameraBasis(snapped);
  });

  it.each([
    ["left", 15],
    ["right", 90],
    ["up", 5],
    ["down", 15],
  ] as const)("applies one %s step at %d degrees", (rotation, degrees) => {
    const initial = createCamera({ position: [0, 0, 5], target: [0, 0, 0] });
    const stepped = rotateCameraByStep(initial, bounds, rotation, degrees);
    expect(stepped.target).toEqual(initial.target);
    expect(length(subtract(stepped.position, stepped.target))).toBeCloseTo(5, 8);
    expectCameraBasis(stepped);
    const restored = rotateCameraByStep(
      stepped,
      bounds,
      rotation === "left"
        ? "right"
        : rotation === "right"
          ? "left"
          : rotation === "up"
            ? "down"
            : "up",
      degrees,
    );
    expect(restored.position[0]).toBeCloseTo(initial.position[0], 8);
    expect(restored.position[1]).toBeCloseTo(initial.position[1], 8);
    expect(restored.position[2]).toBeCloseTo(initial.position[2], 8);
  });

  it.each([
    [
      "canonical front",
      createCamera({ position: [0, 0, 5], width: 100, height: 100, orthoHeight: 10 }),
    ],
    [
      "rolled oblique",
      rotateCameraByStep(
        rotateCameraByStep(
          createCamera({
            position: [4, 3, 6],
            target: [0.5, -0.25, 0.75],
            width: 100,
            height: 100,
          }),
          bounds,
          "clockwise",
          15,
        ),
        bounds,
        "clockwise",
        15,
      ),
    ],
  ] as const)("moves visible content in the named vertical direction from a %s", (_, initial) => {
    const towardCamera = normalize(subtract(initial.position, initial.target));
    const probe = add(initial.target, scale(towardCamera, 1));
    const before = projectPoint(initial, probe);
    const up = projectPoint(rotateCameraByStep(initial, bounds, "up", 15), probe);
    const down = projectPoint(rotateCameraByStep(initial, bounds, "down", 15), probe);
    if (before === undefined || up === undefined || down === undefined) {
      throw new Error("view-cube direction probe must be projectable");
    }
    expect(up[1]).toBeLessThan(before[1]);
    expect(down[1]).toBeGreaterThan(before[1]);
  });

  it.each(["clockwise", "counterclockwise"] as const)(
    "rolls the view %s in the projected screen direction",
    (rotation) => {
      const initial = createCamera({
        position: [0, 0, 5],
        target: [0, 0, 0],
        width: 100,
        height: 100,
        orthoHeight: 10,
      });
      const rolled = rotateCameraByStep(initial, bounds, rotation, 90);
      const probe = projectPoint(rolled, [0, 1, 0]);
      expect(probe?.[0]).toBeCloseTo(50 + (rotation === "clockwise" ? 10 : -10), 6);
      expect(probe?.[1]).toBeCloseTo(50, 6);
      expect(rolled.position).toEqual(initial.position);
      expect(rolled.target).toEqual(initial.target);
      expect(rolled.mode).toBe(initial.mode);
      expect(rolled.orthoHeight).toBe(initial.orthoHeight);
      expect(rolled.fovY).toBe(initial.fovY);
      expect(rolled.near).toBe(initial.near);
      expect(rolled.far).toBe(initial.far);
      expect(rolled.width).toBe(initial.width);
      expect(rolled.height).toBe(initial.height);
      expectCameraBasis(rolled);
    },
  );

  it.each([5, 15, 90] as const)("recovers after a full %d-degree roll revolution", (degrees) => {
    const initial = createCamera({ position: [4, 3, 6], target: [0.5, -0.25, 0.75] });
    const initialUp = effectiveUp(initial);
    const count = 360 / degrees;
    let rolled = initial;
    for (let index = 0; index < count; index += 1) {
      rolled = rotateCameraByStep(rolled, bounds, "clockwise", degrees);
    }
    expect(rolled.position).toEqual(initial.position);
    expect(rolled.target).toEqual(initial.target);
    expect(rolled.up[0]).toBeCloseTo(initialUp[0], 8);
    expect(rolled.up[1]).toBeCloseTo(initialUp[1], 8);
    expect(rolled.up[2]).toBeCloseTo(initialUp[2], 8);
    expectCameraBasis(rolled);
  });

  it("does not mutate the source camera and rejects invalid directions", () => {
    const initial = createCamera({ position: [4, 3, 6] });
    const before = { ...initial, position: [...initial.position], up: [...initial.up] };
    snapCameraToDirection(initial, bounds, [1, 0, 0]);
    expect(initial).toEqual(before);
    expect(() => snapCameraToDirection(initial, bounds, [0, 0, 0])).toThrow(/finite and non-zero/);
  });
});
