import { clientToCanvasCss, type CanvasCssPoint } from "../camera/coordinates";

/**
 * A normalized screen-space rectangle in canvas-local CSS pixels.
 * @category Interaction and picking
 */
export interface BoxSelectionRect {
  /** Left edge in canvas-local CSS pixels. */
  readonly left: number;
  /** Top edge in canvas-local CSS pixels. */
  readonly top: number;
  /** Right edge in canvas-local CSS pixels. */
  readonly right: number;
  /** Bottom edge in canvas-local CSS pixels. */
  readonly bottom: number;
  /** Non-negative normalized width. */
  readonly width: number;
  /** Non-negative normalized height. */
  readonly height: number;
}

/**
 * Modifier keys captured from the pointer that drives the gesture.
 * @category Interaction and picking
 */
export interface BoxSelectionModifiers {
  /** Whether Shift was held. */
  readonly shift: boolean;
  /** Whether Control was held. */
  readonly control: boolean;
  /** Whether Alt was held. */
  readonly alt: boolean;
  /** Whether Meta was held. */
  readonly meta: boolean;
}

/**
 * Why an active box selection ended without completing.
 * @category Interaction and picking
 */
export type BoxSelectionCancelReason =
  "pointer-cancel" | "lost-pointer-capture" | "escape" | "dispose";

/**
 * Lifecycle events emitted while one primary-pointer drag defines a box.
 * Coordinates are canvas-local CSS pixels. A `complete` event is the handoff
 * point for {@link ViewportInteraction.pickRegion} or a host-side
 * {@link boxSelectionFrustum} query; it reports the normalized rectangle and
 * captured modifiers, but never changes interaction state itself.
 * @category Interaction and picking
 */
export type BoxSelectionEvent =
  | {
      /** Gesture lifecycle phase. */
      readonly type: "start" | "change" | "complete";
      /** Initial pointer position. */
      readonly anchor: CanvasCssPoint;
      /** Current pointer position. */
      readonly current: CanvasCssPoint;
      /** Normalized rectangle covered by the gesture. */
      readonly rect: BoxSelectionRect;
      /** Modifier keys captured for this event. */
      readonly modifiers: BoxSelectionModifiers;
    }
  | {
      /** Cancellation lifecycle phase. */
      readonly type: "cancel";
      /** Last normalized rectangle. */
      readonly rect: BoxSelectionRect;
      /** Why the gesture was cancelled. */
      readonly reason: BoxSelectionCancelReason;
    };

/**
 * Options for installing the primary-pointer box-drag lifecycle.
 * @category Interaction and picking
 */
export interface BoxSelectionOptions {
  /** Canvas whose primary-pointer lifecycle is observed. */
  readonly canvas: HTMLCanvasElement;
  /** Enables touch drags when the host has routed touch away from camera navigation. */
  readonly touchEnabled?: () => boolean;
  /** Receives start, change, complete, and cancellation events. */
  readonly onEvent: (event: BoxSelectionEvent) => void;
}

const DRAG_THRESHOLD = 10;

interface BoxDrag {
  readonly pointerId: number;
  readonly anchorClient: CanvasCssPoint;
  readonly anchor: CanvasCssPoint;
  current: CanvasCssPoint;
}

/**
 * Installs the box-drag lifecycle and returns its disposer. A primary mouse or
 * pen drag—or a touch drag explicitly enabled by the host—arms on pointer-down,
 * activates past 10 CSS pixels, and then emits typed
 * start/change/complete/cancel events in canvas-local CSS coordinates.
 * @category Interaction and picking
 */
export function installBoxSelection(options: BoxSelectionOptions): () => void {
  const boxSelection = new BoxSelection(options);
  return () => {
    boxSelection.dispose();
  };
}

class BoxSelection {
  private readonly abortController = new AbortController();
  private readonly canvas: HTMLCanvasElement;
  private readonly onEvent: (event: BoxSelectionEvent) => void;
  private readonly touchEnabled: () => boolean;
  private phase: "idle" | "armed" | "active" = "idle";
  private drag: BoxDrag | undefined;
  private disposed = false;

  constructor(options: BoxSelectionOptions) {
    this.canvas = options.canvas;
    this.onEvent = options.onEvent;
    this.touchEnabled = options.touchEnabled ?? (() => false);
    const pointerListener = { capture: true, signal: this.abortController.signal };
    this.canvas.addEventListener("pointerdown", this.pointerDown, pointerListener);
    this.canvas.addEventListener("pointermove", this.pointerMove, pointerListener);
    this.canvas.addEventListener("pointerup", this.pointerUp, pointerListener);
    this.canvas.addEventListener("pointercancel", this.pointerCancel, pointerListener);
    this.canvas.addEventListener("lostpointercapture", this.lostPointerCapture, pointerListener);
    window.addEventListener("keydown", this.keyDown, { signal: this.abortController.signal });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancel("dispose");
    this.abortController.abort();
  }

  private readonly pointerDown = (event: PointerEvent): void => {
    const touchEnabled = event.pointerType === "touch" && this.touchEnabled();
    if (touchEnabled) event.preventDefault();
    if (this.drag !== undefined) return;
    if (event.button !== 0) return;
    if (event.pointerType !== "mouse" && event.pointerType !== "pen" && !touchEnabled) return;
    const anchor = this.clampedPoint(event);
    this.drag = {
      pointerId: event.pointerId,
      anchorClient: { x: event.clientX, y: event.clientY },
      anchor,
      current: anchor,
    };
    this.phase = "armed";
    if (!this.canvas.hasPointerCapture(event.pointerId)) {
      this.canvas.setPointerCapture(event.pointerId);
    }
  };

  private readonly pointerMove = (event: PointerEvent): void => {
    const drag = this.drag;
    if (drag === undefined || event.pointerId !== drag.pointerId) return;
    if (this.phase === "armed") {
      const distance = Math.hypot(
        event.clientX - drag.anchorClient.x,
        event.clientY - drag.anchorClient.y,
      );
      if (distance <= DRAG_THRESHOLD) return;
      this.phase = "active";
      const current = this.clampedPoint(event);
      drag.current = current;
      event.preventDefault();
      this.onEvent({
        type: "start",
        anchor: drag.anchor,
        current,
        rect: normalizedRect(drag.anchor, current),
        modifiers: modifiersOf(event),
      });
      return;
    }
    event.preventDefault();
    const current = this.clampedPoint(event);
    drag.current = current;
    this.onEvent({
      type: "change",
      anchor: drag.anchor,
      current,
      rect: normalizedRect(drag.anchor, current),
      modifiers: modifiersOf(event),
    });
  };

  private readonly pointerUp = (event: PointerEvent): void => {
    const drag = this.drag;
    if (drag === undefined || event.pointerId !== drag.pointerId) return;
    if (this.phase === "armed" && this.dragDistance(event, drag) > DRAG_THRESHOLD) {
      this.phase = "active";
    }
    if (this.phase === "active") {
      event.preventDefault();
      const current = this.clampedPoint(event);
      const rect = normalizedRect(drag.anchor, current);
      this.reset();
      this.releaseCapture(drag.pointerId);
      this.onEvent({
        type: "complete",
        anchor: drag.anchor,
        current,
        rect,
        modifiers: modifiersOf(event),
      });
      return;
    }
    this.reset();
    this.releaseCapture(drag.pointerId);
  };

  private dragDistance(
    event: { readonly clientX: number; readonly clientY: number },
    drag: BoxDrag,
  ): number {
    return Math.hypot(event.clientX - drag.anchorClient.x, event.clientY - drag.anchorClient.y);
  }

  private readonly pointerCancel = (event: PointerEvent): void => {
    if (this.drag === undefined || event.pointerId !== this.drag.pointerId) return;
    this.cancel("pointer-cancel");
  };

  private readonly lostPointerCapture = (event: PointerEvent): void => {
    if (this.drag === undefined || event.pointerId !== this.drag.pointerId) return;
    this.cancel("lost-pointer-capture");
  };

  private readonly keyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Escape" || this.drag === undefined) return;
    this.cancel("escape");
  };

  private cancel(reason: BoxSelectionCancelReason): void {
    const drag = this.drag;
    if (drag === undefined) return;
    const active = this.phase === "active";
    const rect = normalizedRect(drag.anchor, drag.current);
    this.reset();
    this.releaseCapture(drag.pointerId);
    if (active) this.onEvent({ type: "cancel", rect, reason });
  }

  private reset(): void {
    this.drag = undefined;
    this.phase = "idle";
  }

  private releaseCapture(pointerId: number): void {
    if (this.canvas.hasPointerCapture(pointerId)) {
      this.canvas.releasePointerCapture(pointerId);
    }
  }

  private clampedPoint(event: {
    readonly clientX: number;
    readonly clientY: number;
  }): CanvasCssPoint {
    const rect = this.canvas.getBoundingClientRect();
    const point = clientToCanvasCss(event.clientX, event.clientY, rect);
    return {
      x: clamp(point.x, 0, Math.max(0, rect.width)),
      y: clamp(point.y, 0, Math.max(0, rect.height)),
    };
  }
}

function normalizedRect(anchor: CanvasCssPoint, current: CanvasCssPoint): BoxSelectionRect {
  const left = Math.min(anchor.x, current.x);
  const right = Math.max(anchor.x, current.x);
  const top = Math.min(anchor.y, current.y);
  const bottom = Math.max(anchor.y, current.y);
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

function modifiersOf(event: {
  readonly shiftKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
}): BoxSelectionModifiers {
  return { shift: event.shiftKey, control: event.ctrlKey, alt: event.altKey, meta: event.metaKey };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
