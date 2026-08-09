/** A screen-space pointer position used by the camera gesture tracker. */
export interface GesturePoint {
  readonly x: number;
  readonly y: number;
}

/**
 * The camera-relative delta produced by one pointer move. `deltaX`/`deltaY`
 * are screen-pixel deltas (a single-pointer drag, or the midpoint movement of
 * a two-pointer gesture) and `zoom` is the pinch distance ratio in log scale,
 * positive zooming in.
 */
export interface GestureStep {
  readonly deltaX: number;
  readonly deltaY: number;
  readonly zoom: number;
  readonly pointerCount: number;
}

interface PinchState {
  readonly distance: number;
  readonly midpoint: GesturePoint;
}

function noStep(pointerCount: number): GestureStep {
  return { deltaX: 0, deltaY: 0, zoom: 0, pointerCount };
}

/**
 * Tracks the active pointers of a canvas gesture and turns their movement
 * into camera deltas. One pointer reports its drag delta; two pointers report
 * the midpoint movement (two-finger pan) plus a log-scale zoom from the pinch
 * distance. Three or more pointers freeze the gesture; when a pointer lifts
 * back to one or two, the baseline is recomputed from the current positions so
 * the camera never jumps. `end` is idempotent, so it can be driven by
 * pointerup, pointercancel, lost capture, and an uncaptured pointerout alike.
 */
export class CameraGestureTracker {
  private readonly pointers = new Map<number, GesturePoint>();
  private singleBaseline: GesturePoint | undefined;
  private pinchBaseline: PinchState | undefined;

  get pointerCount(): number {
    return this.pointers.size;
  }

  /** Records a pointer that just went down, returning a no-op step. */
  begin(pointerId: number, point: GesturePoint): GestureStep {
    this.pointers.set(pointerId, point);
    this.recomputeBaselines();
    return noStep(this.pointerCount);
  }

  /** Updates a tracked pointer and returns the camera delta for this move. */
  move(pointerId: number, point: GesturePoint): GestureStep {
    if (!this.pointers.has(pointerId)) return noStep(this.pointerCount);
    this.pointers.set(pointerId, point);
    if (this.pointerCount === 1) return this.singlePointerStep(point);
    if (this.pointerCount === 2) return this.twoPointerStep();
    return noStep(this.pointerCount);
  }

  /** Removes a pointer (up, cancel, or lost capture), returning a no-op step. */
  end(pointerId: number): GestureStep {
    this.pointers.delete(pointerId);
    this.recomputeBaselines();
    return noStep(this.pointerCount);
  }

  /** Drops every pointer, ending the gesture. */
  clear(): void {
    this.pointers.clear();
    this.singleBaseline = undefined;
    this.pinchBaseline = undefined;
  }

  private singlePointerStep(point: GesturePoint): GestureStep {
    const baseline = this.singleBaseline ?? point;
    const step: GestureStep = {
      deltaX: point.x - baseline.x,
      deltaY: point.y - baseline.y,
      zoom: 0,
      pointerCount: 1,
    };
    this.singleBaseline = point;
    return step;
  }

  private twoPointerStep(): GestureStep {
    const [a, b] = this.twoPointers();
    if (a === undefined || b === undefined) return noStep(2);
    const distance = Math.hypot(a.x - b.x, a.y - b.y);
    const midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const baseline = this.pinchBaseline ?? { distance, midpoint };
    const zoom = distance > 0 && baseline.distance > 0 ? Math.log(distance / baseline.distance) : 0;
    this.pinchBaseline = { distance, midpoint };
    return {
      deltaX: midpoint.x - baseline.midpoint.x,
      deltaY: midpoint.y - baseline.midpoint.y,
      zoom,
      pointerCount: 2,
    };
  }

  private twoPointers(): readonly [GesturePoint | undefined, GesturePoint | undefined] {
    const [a, b] = this.pointers.values();
    return [a, b];
  }

  private recomputeBaselines(): void {
    if (this.pointerCount === 1) {
      this.singleBaseline = this.pointers.values().next().value;
      this.pinchBaseline = undefined;
      return;
    }
    if (this.pointerCount === 2) {
      this.singleBaseline = undefined;
      const [a, b] = this.twoPointers();
      if (a === undefined || b === undefined) return;
      this.pinchBaseline = {
        distance: Math.hypot(a.x - b.x, a.y - b.y),
        midpoint: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      };
      return;
    }
    this.singleBaseline = undefined;
    this.pinchBaseline = undefined;
  }
}
