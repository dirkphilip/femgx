import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installBoxSelection, type BoxSelectionEvent } from "../../src/index";

interface PointerInput {
  readonly pointerId: number;
  readonly pointerType: string;
  readonly button: number;
  readonly shiftKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
  readonly clientX: number;
  readonly clientY: number;
  readonly preventDefault: () => void;
}

class FakeWindow {
  private readonly listeners = new Map<string, (event: KeyboardEvent) => void>();

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    this.listeners.set(type, listener as (event: KeyboardEvent) => void);
  }

  dispatch(type: string, event: { readonly key: string }): void {
    this.listeners.get(type)?.(event as KeyboardEvent);
  }
}

class FakeCanvas {
  private readonly listeners = new Map<string, (event: PointerEvent) => void>();
  private readonly captures = new Set<number>();
  private readonly rect: {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
  };

  constructor(
    rect: {
      readonly left: number;
      readonly top: number;
      readonly width: number;
      readonly height: number;
    } = { left: 10, top: 20, width: 200, height: 100 },
  ) {
    this.rect = rect;
  }

  getBoundingClientRect(): DOMRect {
    return this.rect as DOMRect;
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    this.listeners.set(type, listener as (event: PointerEvent) => void);
  }

  dispatch(type: string, event: PointerInput): void {
    this.listeners.get(type)?.(event as PointerEvent);
  }

  hasPointerCapture(pointerId: number): boolean {
    return this.captures.has(pointerId);
  }

  setPointerCapture(pointerId: number): void {
    this.captures.add(pointerId);
  }

  releasePointerCapture(pointerId: number): void {
    this.captures.delete(pointerId);
  }

  /** Simulates the browser dropping capture outside our own release path. */
  dropCapture(pointerId: number): void {
    this.captures.delete(pointerId);
  }

  captureCount(): number {
    return this.captures.size;
  }
}

const pointer = (overrides: Partial<PointerInput> = {}): PointerInput => ({
  pointerId: 1,
  pointerType: "mouse",
  button: 0,
  shiftKey: false,
  ctrlKey: false,
  altKey: false,
  metaKey: false,
  clientX: 100,
  clientY: 50,
  preventDefault: vi.fn(),
  ...overrides,
});

interface Harness {
  readonly canvas: FakeCanvas;
  readonly events: BoxSelectionEvent[];
  readonly disposer: () => void;
}

function install(
  rect?: {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
  },
  touchEnabled?: () => boolean,
): Harness {
  const canvas = new FakeCanvas(rect);
  const events: BoxSelectionEvent[] = [];
  const disposer = installBoxSelection({
    canvas: canvas as unknown as HTMLCanvasElement,
    ...(touchEnabled === undefined ? {} : { touchEnabled }),
    onEvent: (event) => {
      events.push(event);
    },
  });
  return { canvas, events, disposer };
}

function terminalTypes(events: readonly BoxSelectionEvent[]): readonly string[] {
  return events.map((event) => event.type);
}

const originalWindow = (globalThis as { readonly window?: unknown }).window;
let fakeWindow: FakeWindow;

beforeEach(() => {
  fakeWindow = new FakeWindow();
  (globalThis as { window?: unknown }).window = fakeWindow;
});

afterEach(() => {
  if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
  else (globalThis as { window?: unknown }).window = originalWindow;
  vi.clearAllMocks();
});

describe("installBoxSelection", () => {
  it("emits no event below the threshold, then start, ordered change, and one complete", () => {
    const { canvas, events, disposer } = install();
    canvas.dispatch("pointerdown", pointer({ clientX: 100, clientY: 50 }));
    expect(canvas.captureCount()).toBe(1);

    canvas.dispatch("pointermove", pointer({ clientX: 105, clientY: 55 }));
    expect(events).toEqual([]);

    canvas.dispatch("pointermove", pointer({ clientX: 115, clientY: 55 }));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "start",
      anchor: { x: 90, y: 30 },
      current: { x: 105, y: 35 },
      rect: { left: 90, top: 30, right: 105, bottom: 35, width: 15, height: 5 },
    });

    canvas.dispatch("pointermove", pointer({ clientX: 130, clientY: 70 }));
    expect(events[1]).toMatchObject({
      type: "change",
      rect: { left: 90, top: 30, right: 120, bottom: 50, width: 30, height: 20 },
    });

    canvas.dispatch("pointerup", pointer({ clientX: 130, clientY: 70 }));
    expect(events[2]).toMatchObject({ type: "complete" });
    expect(terminalTypes(events)).toEqual(["start", "change", "complete"]);
    expect(canvas.captureCount()).toBe(0);

    disposer();
  });

  it("follows the same lifecycle for a pen pointer", () => {
    const { canvas, events, disposer } = install();
    canvas.dispatch("pointerdown", pointer({ pointerType: "pen", clientX: 100, clientY: 50 }));
    canvas.dispatch("pointermove", pointer({ pointerType: "pen", clientX: 120, clientY: 70 }));
    canvas.dispatch("pointerup", pointer({ pointerType: "pen", clientX: 120, clientY: 70 }));

    expect(terminalTypes(events)).toEqual(["start", "complete"]);
    disposer();
  });

  it("supports touch only when the host explicitly enables it", () => {
    const { canvas, events, disposer } = install(undefined, () => true);
    const down = pointer({ pointerType: "touch", clientX: 100, clientY: 50 });
    const up = pointer({ pointerType: "touch", clientX: 120, clientY: 70 });
    canvas.dispatch("pointerdown", down);
    canvas.dispatch("pointermove", pointer({ pointerType: "touch", clientX: 120, clientY: 70 }));
    canvas.dispatch("pointerup", up);

    expect(down.preventDefault).toHaveBeenCalledOnce();
    expect(up.preventDefault).toHaveBeenCalledOnce();
    expect(terminalTypes(events)).toEqual(["start", "complete"]);
    disposer();
  });

  it("completes a fast drag when pointer-up is the first event beyond the threshold", () => {
    const { canvas, events, disposer } = install();
    canvas.dispatch("pointerdown", pointer({ clientX: 100, clientY: 50 }));
    canvas.dispatch("pointerup", pointer({ clientX: 130, clientY: 80 }));

    expect(terminalTypes(events)).toEqual(["complete"]);
    expect(events[0]).toMatchObject({
      type: "complete",
      anchor: { x: 90, y: 30 },
      current: { x: 120, y: 60 },
      rect: { left: 90, top: 30, right: 120, bottom: 60, width: 30, height: 30 },
    });
    expect(canvas.captureCount()).toBe(0);
    disposer();
  });

  it("ignores touch and non-primary buttons without arming", () => {
    const { canvas, events, disposer } = install();
    canvas.dispatch("pointerdown", pointer({ pointerType: "touch", clientX: 100, clientY: 50 }));
    canvas.dispatch("pointermove", pointer({ pointerType: "touch", clientX: 130, clientY: 80 }));
    expect(events).toEqual([]);
    expect(canvas.captureCount()).toBe(0);

    canvas.dispatch("pointerdown", pointer({ button: 1 }));
    canvas.dispatch("pointermove", pointer({ button: 1, clientX: 130, clientY: 80 }));
    canvas.dispatch("pointerup", pointer({ button: 1, clientX: 130, clientY: 80 }));
    expect(events).toEqual([]);

    canvas.dispatch("pointerdown", pointer({ button: 2 }));
    canvas.dispatch("pointermove", pointer({ button: 2, clientX: 130, clientY: 80 }));
    expect(events).toEqual([]);
    expect(canvas.captureCount()).toBe(0);
    disposer();
  });

  it("accounts for the canvas client offset and clamps on every side", () => {
    const { canvas, events, disposer } = install({ left: 20, top: 30, width: 160, height: 90 });
    // The down point is above-left of the content box, so the anchor clamps to (0,0).
    canvas.dispatch("pointerdown", pointer({ clientX: 10, clientY: 5 }));
    // The move point is past the bottom-right, so the current clamps to the CSS size.
    canvas.dispatch("pointermove", pointer({ clientX: 300, clientY: 200 }));

    expect(events[0]).toMatchObject({
      type: "start",
      anchor: { x: 0, y: 0 },
      current: { x: 160, y: 90 },
      rect: { left: 0, top: 0, right: 160, bottom: 90, width: 160, height: 90 },
    });

    // A drag anchored at the bottom-right clamps the current to the top-left.
    canvas.dispatch("pointerup", pointer({ clientX: 300, clientY: 200 }));
    canvas.dispatch("pointerdown", pointer({ clientX: 400, clientY: 300 }));
    canvas.dispatch("pointermove", pointer({ clientX: -50, clientY: -50 }));
    expect(events.at(-1)).toMatchObject({
      type: "start",
      anchor: { x: 160, y: 90 },
      current: { x: 0, y: 0 },
      rect: { left: 0, top: 0, right: 160, bottom: 90, width: 160, height: 90 },
    });
    disposer();
  });

  it.each([
    [
      "down-right",
      { x: 120, y: 70 },
      { left: 100, top: 50, right: 120, bottom: 70, width: 20, height: 20 },
    ],
    [
      "up-left",
      { x: 60, y: 10 },
      { left: 60, top: 10, right: 100, bottom: 50, width: 40, height: 40 },
    ],
    [
      "down-left",
      { x: 60, y: 70 },
      { left: 60, top: 50, right: 100, bottom: 70, width: 40, height: 20 },
    ],
    [
      "up-right",
      { x: 120, y: 10 },
      { left: 100, top: 10, right: 120, bottom: 50, width: 20, height: 40 },
    ],
  ])("normalizes a %s drag", (_, current, expected) => {
    const { canvas, events, disposer } = install({ left: 0, top: 0, width: 200, height: 100 });
    canvas.dispatch("pointerdown", pointer({ clientX: 100, clientY: 50 }));
    canvas.dispatch("pointermove", pointer({ clientX: current.x, clientY: current.y }));
    expect(events[0]).toMatchObject({ type: "start", rect: expected });
    expect(events[0]).toMatchObject({ type: "start", current });
    disposer();
  });

  it("preserves modifiers and observes changes between events", () => {
    const { canvas, events, disposer } = install();
    canvas.dispatch("pointerdown", pointer({ clientX: 100, clientY: 50 }));
    canvas.dispatch("pointermove", pointer({ clientX: 120, clientY: 70, shiftKey: true }));
    expect(events[0]).toMatchObject({
      type: "start",
      modifiers: { shift: true, control: false, alt: false, meta: false },
    });

    canvas.dispatch(
      "pointermove",
      pointer({ clientX: 140, clientY: 90, ctrlKey: true, altKey: true }),
    );
    expect(events[1]).toMatchObject({
      type: "change",
      modifiers: { shift: false, control: true, alt: true, meta: false },
    });

    canvas.dispatch("pointerup", pointer({ clientX: 140, clientY: 90, metaKey: true }));
    expect(events[2]).toMatchObject({
      type: "complete",
      modifiers: { shift: false, control: false, alt: false, meta: true },
    });
    disposer();
  });

  it("ignores moves and ups from unrelated pointer ids", () => {
    const { canvas, events, disposer } = install();
    canvas.dispatch("pointerdown", pointer({ clientX: 100, clientY: 50 }));
    canvas.dispatch("pointermove", pointer({ pointerId: 2, clientX: 130, clientY: 80 }));
    expect(events).toEqual([]);

    canvas.dispatch("pointermove", pointer({ clientX: 130, clientY: 80 }));
    canvas.dispatch("pointermove", pointer({ pointerId: 2, clientX: 140, clientY: 90 }));
    expect(events).toHaveLength(1);

    canvas.dispatch("pointerup", pointer({ pointerId: 2, clientX: 140, clientY: 90 }));
    expect(events).toHaveLength(1);

    canvas.dispatch("pointerup", pointer({ clientX: 140, clientY: 90 }));
    expect(terminalTypes(events)).toEqual(["start", "complete"]);
    disposer();
  });

  it("acquires and safely releases pointer capture", () => {
    const { canvas, events, disposer } = install();
    canvas.dispatch("pointerdown", pointer({ clientX: 100, clientY: 50 }));
    expect(canvas.hasPointerCapture(1)).toBe(true);

    canvas.dispatch("pointerup", pointer({ clientX: 100, clientY: 50 }));
    expect(canvas.hasPointerCapture(1)).toBe(false);
    expect(events).toEqual([]);
    disposer();
  });

  it("cancels on pointercancel with the documented reason", () => {
    const { canvas, events, disposer } = install();
    canvas.dispatch("pointerdown", pointer({ clientX: 100, clientY: 50 }));
    canvas.dispatch("pointermove", pointer({ clientX: 130, clientY: 80 }));
    canvas.dispatch("pointercancel", pointer({ clientX: 130, clientY: 80 }));

    expect(events.at(-1)).toEqual({
      type: "cancel",
      rect: { left: 90, top: 30, right: 120, bottom: 60, width: 30, height: 30 },
      reason: "pointer-cancel",
    });
    expect(events).toHaveLength(2);
    expect(canvas.captureCount()).toBe(0);

    canvas.dispatch("pointermove", pointer({ clientX: 150, clientY: 90 }));
    expect(events).toHaveLength(2);
    disposer();
  });

  it("cancels on unexpected capture loss", () => {
    const { canvas, events, disposer } = install();
    canvas.dispatch("pointerdown", pointer({ clientX: 100, clientY: 50 }));
    canvas.dispatch("pointermove", pointer({ clientX: 130, clientY: 80 }));
    canvas.dropCapture(1);
    canvas.dispatch("lostpointercapture", pointer({ clientX: 130, clientY: 80 }));

    expect(events.at(-1)).toMatchObject({ type: "cancel", reason: "lost-pointer-capture" });
    expect(events).toHaveLength(2);
    disposer();
  });

  it("cancels on Escape only while a gesture is armed or active", () => {
    const { canvas, events, disposer } = install();
    fakeWindow.dispatch("keydown", { key: "Escape" });
    expect(events).toEqual([]);

    canvas.dispatch("pointerdown", pointer({ clientX: 100, clientY: 50 }));
    canvas.dispatch("pointermove", pointer({ clientX: 130, clientY: 80 }));
    fakeWindow.dispatch("keydown", { key: "Escape" });
    expect(events.at(-1)).toMatchObject({ type: "cancel", reason: "escape" });
    expect(events).toHaveLength(2);
    expect(canvas.captureCount()).toBe(0);
    disposer();
  });

  it("emits a dispose cancellation and stays inert afterwards", () => {
    const { canvas, events, disposer } = install();
    canvas.dispatch("pointerdown", pointer({ clientX: 100, clientY: 50 }));
    canvas.dispatch("pointermove", pointer({ clientX: 130, clientY: 80 }));

    disposer();
    expect(events.at(-1)).toMatchObject({ type: "cancel", reason: "dispose" });
    expect(events).toHaveLength(2);
    expect(canvas.captureCount()).toBe(0);

    canvas.dispatch("pointermove", pointer({ clientX: 150, clientY: 90 }));
    canvas.dispatch("pointerup", pointer({ clientX: 150, clientY: 90 }));
    expect(events).toHaveLength(2);
  });

  it("emits nothing for armed-but-never-active cancellation", () => {
    const { canvas, events, disposer } = install();
    canvas.dispatch("pointerdown", pointer({ clientX: 100, clientY: 50 }));
    fakeWindow.dispatch("keydown", { key: "Escape" });
    expect(events).toEqual([]);
    expect(canvas.captureCount()).toBe(0);

    canvas.dispatch("pointerdown", pointer({ clientX: 100, clientY: 50 }));
    canvas.dispatch("pointerup", pointer({ clientX: 100, clientY: 50 }));
    expect(events).toEqual([]);
    expect(canvas.captureCount()).toBe(0);
    disposer();
  });

  it("does not emit a second terminal event when capture is lost after completion", () => {
    const { canvas, events, disposer } = install();
    canvas.dispatch("pointerdown", pointer({ clientX: 100, clientY: 50 }));
    canvas.dispatch("pointermove", pointer({ clientX: 130, clientY: 80 }));
    canvas.dispatch("pointerup", pointer({ clientX: 130, clientY: 80 }));
    expect(terminalTypes(events)).toEqual(["start", "complete"]);

    canvas.dropCapture(1);
    canvas.dispatch("lostpointercapture", pointer({ clientX: 130, clientY: 80 }));
    expect(terminalTypes(events)).toEqual(["start", "complete"]);
    disposer();
  });

  it("is idempotent and prevents default only once active", () => {
    const { canvas, events, disposer } = install();
    const belowMove = pointer({ clientX: 105, clientY: 55 });
    canvas.dispatch("pointerdown", pointer({ clientX: 100, clientY: 50 }));
    canvas.dispatch("pointermove", belowMove);
    expect(belowMove.preventDefault).not.toHaveBeenCalled();

    const activation = pointer({ clientX: 120, clientY: 60 });
    canvas.dispatch("pointermove", activation);
    expect(activation.preventDefault).toHaveBeenCalledOnce();

    const activeMove = pointer({ clientX: 140, clientY: 80 });
    canvas.dispatch("pointermove", activeMove);
    expect(activeMove.preventDefault).toHaveBeenCalledOnce();

    canvas.dispatch("pointerup", pointer({ clientX: 140, clientY: 80 }));
    disposer();
    disposer();
    expect(terminalTypes(events)).toEqual(["start", "change", "complete"]);
  });

  it("ignores a concurrent pointer while a drag is tracked", () => {
    const { canvas, events, disposer } = install();
    canvas.dispatch("pointerdown", pointer({ clientX: 100, clientY: 50 }));
    canvas.dispatch("pointerdown", pointer({ pointerId: 2, clientX: 110, clientY: 60 }));
    expect(canvas.captureCount()).toBe(1);

    canvas.dispatch("pointermove", pointer({ pointerId: 2, clientX: 130, clientY: 80 }));
    expect(events).toEqual([]);

    canvas.dispatch("pointermove", pointer({ clientX: 130, clientY: 80 }));
    expect(events).toHaveLength(1);
    disposer();
  });
});
