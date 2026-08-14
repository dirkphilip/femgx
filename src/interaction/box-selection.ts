import { clientToCanvasCss, type CanvasCssPoint } from "../camera/coordinates";

/**
 * A normalized screen-space rectangle in canvas-local CSS pixels.
 * @category Interaction and picking
 */
export interface BoxSelectionRect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Modifier keys captured from the pointer that drives the gesture.
 * @category Interaction and picking
 */
export interface BoxSelectionModifiers {
  readonly shift: boolean;
  readonly control: boolean;
  readonly alt: boolean;
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
 * @category Interaction and picking
 */
export type BoxSelectionEvent =
  | {
      readonly type: "start" | "change" | "complete";
      readonly anchor: CanvasCssPoint;
      readonly current: CanvasCssPoint;
      readonly rect: BoxSelectionRect;
      readonly modifiers: BoxSelectionModifiers;
    }
  | {
      readonly type: "cancel";
      readonly rect: BoxSelectionRect;
      readonly reason: BoxSelectionCancelReason;
    };

/**
 * Options for installing the primary-pointer box-drag lifecycle.
 * @category Interaction and picking
 */
export interface BoxSelectionOptions {
  readonly canvas: HTMLCanvasElement;
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
 * pen drag arms on pointer-down, activates past 10 CSS pixels, and then emits
 * typed start/change/complete/cancel events in canvas-local CSS coordinates.
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
  private phase: "idle" | "armed" | "active" = "idle";
  private drag: BoxDrag | undefined;
  private disposed = false;

  constructor(options: BoxSelectionOptions) {
    this.canvas = options.canvas;
    this.onEvent = options.onEvent;
    const signal = { signal: this.abortController.signal };
    this.canvas.addEventListener("pointerdown", this.pointerDown, signal);
    this.canvas.addEventListener("pointermove", this.pointerMove, signal);
    this.canvas.addEventListener("pointerup", this.pointerUp, signal);
    this.canvas.addEventListener("pointercancel", this.pointerCancel, signal);
    this.canvas.addEventListener("lostpointercapture", this.lostPointerCapture, signal);
    window.addEventListener("keydown", this.keyDown, signal);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancel("dispose");
    this.abortController.abort();
  }

  private readonly pointerDown = (event: PointerEvent): void => {
    if (this.drag !== undefined) return;
    if (event.button !== 0) return;
    if (event.pointerType !== "mouse" && event.pointerType !== "pen") return;
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
