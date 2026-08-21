import { describe, expect, it, vi } from "vitest";
import { createCamera } from "../../src/camera/camera";
import { installViewportCanvasBindings, installViewportKeyboard } from "../../src/viewport/dom";
import type { ViewportOptions } from "../../src/viewport/types";

interface KeyInput {
  readonly key: string;
  readonly repeat?: boolean;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
  readonly altKey?: boolean;
  readonly target?: EventTarget | null;
  readonly preventDefault: () => void;
}

class KeyboardTarget {
  private listener: ((event: Event) => void) | undefined;

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (type === "keydown") this.listener = listener as (event: Event) => void;
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (type === "keydown" && this.listener === listener) this.listener = undefined;
  }

  dispatchEvent(_event: Event): boolean {
    return false;
  }

  dispatch(input: KeyInput): void {
    this.listener?.(input as unknown as Event);
  }

  get hasListener(): boolean {
    return this.listener !== undefined;
  }
}

class TrackingCanvas extends EventTarget {
  readonly activeListeners = new Set<string>();

  override addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ): void {
    this.activeListeners.add(type);
    const signal = typeof options === "object" ? options.signal : undefined;
    signal?.addEventListener("abort", () => this.activeListeners.delete(type), {
      once: true,
    });
    super.addEventListener(type, listener, options);
  }

  override removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions,
  ): void {
    this.activeListeners.delete(type);
    super.removeEventListener(type, listener, options);
  }

  getBoundingClientRect(): DOMRect {
    return { width: 800, height: 600, left: 0, top: 0 } as DOMRect;
  }

  hasPointerCapture(): boolean {
    return false;
  }

  setPointerCapture(): void {}

  releasePointerCapture(): void {}
}

function key(overrides: Partial<KeyInput> = {}): KeyInput {
  return {
    key: "z",
    preventDefault: vi.fn(),
    ...overrides,
  };
}

describe("viewport keyboard ownership", () => {
  it("handles Z only for an explicit host target and removes the listener", () => {
    const target = new KeyboardTarget();
    const fitSelection = vi.fn();
    const remove = installViewportKeyboard(target, fitSelection);
    const lower = key();
    const upper = key({ key: "Z" });
    target.dispatch(lower);
    target.dispatch(upper);

    expect(fitSelection).toHaveBeenCalledTimes(2);
    expect(lower.preventDefault).toHaveBeenCalledOnce();
    expect(upper.preventDefault).toHaveBeenCalledOnce();

    remove();
    target.dispatch(key());
    expect(fitSelection).toHaveBeenCalledTimes(2);
  });

  it.each([
    { name: "repeat", repeat: true },
    { name: "control", ctrlKey: true },
    { name: "meta", metaKey: true },
    { name: "alt", altKey: true },
    { name: "input", target: { tagName: "INPUT" } as unknown as EventTarget },
    { name: "textarea", target: { tagName: "TEXTAREA" } as unknown as EventTarget },
    { name: "select", target: { tagName: "SELECT" } as unknown as EventTarget },
    { name: "contenteditable", target: { isContentEditable: true } as unknown as EventTarget },
  ])("ignores $name", (overrides) => {
    const target = new KeyboardTarget();
    const fitSelection = vi.fn();
    installViewportKeyboard(target, fitSelection);
    const event = key(overrides);
    target.dispatch(event);

    expect(fitSelection).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("does not install an implicit global listener", () => {
    const fitSelection = vi.fn();
    expect(installViewportKeyboard(undefined, fitSelection)).toBeTypeOf("function");
    expect(fitSelection).not.toHaveBeenCalled();
  });
});

describe("viewport canvas binding ownership", () => {
  it("rolls back earlier bindings when resize setup fails", () => {
    const canvas = new TrackingCanvas();
    const keyboard = new KeyboardTarget();
    const hadResizeObserver = "ResizeObserver" in globalThis;
    const originalResizeObserver = globalThis.ResizeObserver;
    class FailingResizeObserver {
      observe(): void {
        throw new Error("resize setup failed");
      }

      disconnect(): void {}
    }
    Object.defineProperty(globalThis, "ResizeObserver", {
      configurable: true,
      value: FailingResizeObserver,
    });

    try {
      expect(() =>
        installViewportCanvasBindings({
          options: { canvas, keyboardTarget: keyboard } as unknown as ViewportOptions,
          renderer: {
            pickPoint: vi.fn(),
            setOrbitPivot: vi.fn(),
          } as never,
          cameraRef: { camera: createCamera() },
          navigationBounds: () => ({
            bounds: { minX: -1, minY: -1, minZ: -1, maxX: 1, maxY: 1, maxZ: 1 },
            protectedBounds: [],
          }),
          fitSelection: vi.fn(),
          invalidate: vi.fn(),
          resize: vi.fn(),
          onGestureChange: vi.fn(),
          onOrientationAction: vi.fn(),
        }),
      ).toThrow("resize setup failed");
      expect(keyboard.hasListener).toBe(false);
      expect(canvas.activeListeners).toHaveLength(0);
    } finally {
      if (!hadResizeObserver) Reflect.deleteProperty(globalThis, "ResizeObserver");
      else
        Object.defineProperty(globalThis, "ResizeObserver", {
          configurable: true,
          value: originalResizeObserver,
        });
    }
  });
});
