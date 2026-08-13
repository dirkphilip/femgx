import { describe, expect, it } from "vitest";
import { createCamera } from "../../src/camera/camera";
import {
  createCameraTransition,
  type CameraTransitionClock,
} from "../../src/viewport/camera-transition";

interface ScheduledFrame {
  readonly id: number;
  readonly callback: (time: number) => void;
}

function clockHarness(): {
  readonly clock: CameraTransitionClock;
  readonly frames: ScheduledFrame[];
  readonly cancelled: number[];
} {
  let nextId = 0;
  const frames: ScheduledFrame[] = [];
  const cancelled: number[] = [];
  return {
    frames,
    cancelled,
    clock: {
      schedule: (callback) => {
        const frame = { id: nextId++, callback };
        frames.push(frame);
        return frame.id;
      },
      cancel: (id) => {
        cancelled.push(id);
        const index = frames.findIndex((frame) => frame.id === id);
        if (index >= 0) frames.splice(index, 1);
      },
    },
  };
}

describe("camera transitions", () => {
  it("reports deterministic eased progress and lands exactly on the endpoint", () => {
    const harness = clockHarness();
    const initial = createCamera({ position: [0, 0, 5], target: [0, 0, 0] });
    const target = createCamera({ position: [0, 2, 8], target: [0, 2, 0] });
    const updates: Array<{ readonly y: number; readonly complete: boolean }> = [];
    createCameraTransition(harness.clock).start(initial, target, 100, (camera, complete) => {
      updates.push({ y: camera.position[1], complete });
    });

    harness.frames.shift()?.callback(0);
    harness.frames.shift()?.callback(25);
    expect(updates[0]).toEqual({ y: 0, complete: false });
    expect(updates[1]?.y).toBeCloseTo(1.15625, 6);
    expect(updates[1]?.complete).toBe(false);

    harness.frames.shift()?.callback(100);
    expect(updates.at(-1)).toEqual({ y: 2, complete: true });
    expect(harness.frames).toHaveLength(0);
  });

  it("cancels without emitting an endpoint jump", () => {
    const harness = clockHarness();
    const initial = createCamera({ position: [0, 0, 5], target: [0, 0, 0] });
    const target = createCamera({ position: [0, 2, 8], target: [0, 2, 0] });
    const updates: number[] = [];
    const transition = createCameraTransition(harness.clock);
    transition.start(initial, target, 100, (camera) => updates.push(camera.position[1]));
    harness.frames.shift()?.callback(0);
    harness.frames.shift()?.callback(50);
    const last = updates.at(-1);
    transition.cancel();

    expect(last).toBeDefined();
    expect(updates.at(-1)).toBe(last);
    expect(harness.cancelled).toHaveLength(1);
    expect(harness.frames).toHaveLength(0);
  });

  it("applies zero-duration transitions immediately", () => {
    const harness = clockHarness();
    const initial = createCamera();
    const target = createCamera({ position: [0, 1, 5], target: [0, 1, 0] });
    const updates: Array<{ readonly camera: unknown; readonly complete: boolean }> = [];
    createCameraTransition(harness.clock).start(initial, target, 0, (camera, complete) => {
      updates.push({ camera, complete });
    });

    expect(updates).toEqual([{ camera: target, complete: true }]);
    expect(harness.frames).toHaveLength(0);
  });
});
