import { describe, expect, it } from "vitest";
import { CameraGestureTracker } from "../../src/camera/gestures";

describe("CameraGestureTracker", () => {
  it("tracks a single-pointer drag as pixel deltas", () => {
    const tracker = new CameraGestureTracker();
    expect(tracker.pointerCount).toBe(0);
    expect(tracker.begin(1, { x: 100, y: 100 })).toEqual({
      deltaX: 0,
      deltaY: 0,
      zoom: 0,
      pointerCount: 1,
    });
    expect(tracker.pointerCount).toBe(1);
    expect(tracker.move(1, { x: 105, y: 110 })).toEqual({
      deltaX: 5,
      deltaY: 10,
      zoom: 0,
      pointerCount: 1,
    });
    expect(tracker.move(1, { x: 105, y: 115 })).toEqual({
      deltaX: 0,
      deltaY: 5,
      zoom: 0,
      pointerCount: 1,
    });
  });

  it("starts a pinch baseline when a second pointer lands", () => {
    const tracker = new CameraGestureTracker();
    tracker.begin(1, { x: 0, y: 0 });
    expect(tracker.begin(2, { x: 100, y: 0 })).toEqual({
      deltaX: 0,
      deltaY: 0,
      zoom: 0,
      pointerCount: 2,
    });
  });

  it("zooms by the pinch distance ratio and pans by the midpoint", () => {
    const tracker = new CameraGestureTracker();
    tracker.begin(1, { x: 0, y: 0 });
    tracker.begin(2, { x: 100, y: 0 });

    const spread = tracker.move(1, { x: -10, y: 0 });
    expect(spread.pointerCount).toBe(2);
    expect(spread.deltaX).toBe(-5);
    expect(spread.deltaY).toBe(0);
    expect(spread.zoom).toBeCloseTo(Math.log(110 / 100));

    const slide = tracker.move(2, { x: 110, y: 0 });
    expect(slide.deltaX).toBe(5);
    expect(slide.zoom).toBeCloseTo(Math.log(120 / 110));

    const pinch = tracker.move(1, { x: 10, y: 0 });
    expect(pinch.zoom).toBeCloseTo(Math.log(100 / 120));
    expect(pinch.zoom).toBeLessThan(0);
  });

  it("reports midpoint movement when both fingers travel together", () => {
    const tracker = new CameraGestureTracker();
    tracker.begin(1, { x: 40, y: 0 });
    tracker.begin(2, { x: 60, y: 0 });
    const step = tracker.move(1, { x: 50, y: 10 });
    expect(step.deltaX).toBe(5);
    expect(step.deltaY).toBe(5);
    expect(step.zoom).toBeCloseTo(Math.log(Math.hypot(10, 10) / 20));
  });

  it("resumes a single-pointer drag without a jump after a finger lifts", () => {
    const tracker = new CameraGestureTracker();
    tracker.begin(1, { x: 0, y: 0 });
    tracker.begin(2, { x: 100, y: 0 });
    tracker.move(1, { x: -10, y: 0 });
    tracker.move(2, { x: 110, y: 0 });

    expect(tracker.end(2)).toEqual({ deltaX: 0, deltaY: 0, zoom: 0, pointerCount: 1 });
    expect(tracker.move(1, { x: -10, y: 5 })).toEqual({
      deltaX: 0,
      deltaY: 5,
      zoom: 0,
      pointerCount: 1,
    });
  });

  it("recomputes the pinch baseline when a gesture drops back to two pointers", () => {
    const tracker = new CameraGestureTracker();
    tracker.begin(1, { x: 0, y: 0 });
    tracker.begin(2, { x: 100, y: 0 });
    tracker.begin(3, { x: 50, y: 100 });

    expect(tracker.pointerCount).toBe(3);
    expect(tracker.move(1, { x: 10, y: 0 })).toEqual({
      deltaX: 0,
      deltaY: 0,
      zoom: 0,
      pointerCount: 3,
    });

    tracker.end(3);
    const step = tracker.move(1, { x: 15, y: 0 });
    expect(step.pointerCount).toBe(2);
    expect(step.zoom).toBeCloseTo(Math.log(85 / 90));
  });

  it("ignores moves for untracked pointers and after the gesture ends", () => {
    const tracker = new CameraGestureTracker();
    expect(tracker.move(1, { x: 5, y: 5 })).toEqual({
      deltaX: 0,
      deltaY: 0,
      zoom: 0,
      pointerCount: 0,
    });
    tracker.begin(1, { x: 0, y: 0 });
    expect(tracker.move(2, { x: 5, y: 5 })).toEqual({
      deltaX: 0,
      deltaY: 0,
      zoom: 0,
      pointerCount: 1,
    });
    tracker.end(1);
    expect(tracker.move(1, { x: 5, y: 5 })).toEqual({
      deltaX: 0,
      deltaY: 0,
      zoom: 0,
      pointerCount: 0,
    });
  });

  it("end is idempotent and clear drops every pointer", () => {
    const tracker = new CameraGestureTracker();
    tracker.begin(1, { x: 0, y: 0 });
    tracker.begin(2, { x: 100, y: 0 });
    expect(tracker.end(2).pointerCount).toBe(1);
    expect(tracker.end(2).pointerCount).toBe(1);
    tracker.clear();
    expect(tracker.pointerCount).toBe(0);
    expect(tracker.move(1, { x: 5, y: 5 }).pointerCount).toBe(0);
  });
});
