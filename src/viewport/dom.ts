import type { OrientationGizmoOptions } from "./orientation-gizmo";
import type { ViewportBackground } from "./types";

/** Validates the renderer-owned viewport background option. */
export function assertViewportBackground(
  value: unknown,
): asserts value is ViewportBackground | undefined {
  if (value === undefined || value === "studio" || value === "white" || value === "dark") return;
  throw new Error("Invalid viewport background; expected studio, white, or dark");
}

/** Returns the canvas's usable CSS-pixel dimensions. */
export function cssSize(canvas: HTMLCanvasElement): {
  readonly width: number;
  readonly height: number;
} {
  const rect = canvas.getBoundingClientRect();
  return { width: Math.max(1, rect.width), height: Math.max(1, rect.height) };
}

/** Installs the browser resize observation used by one viewport. */
export function installResize(canvas: HTMLCanvasElement, resize: () => void): () => void {
  if (typeof ResizeObserver !== "undefined") {
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    return () => {
      observer.disconnect();
    };
  }
  if (typeof window === "undefined") return () => {};
  window.addEventListener("resize", resize);
  return () => {
    window.removeEventListener("resize", resize);
  };
}

/** Installs the host-scoped core `Z` shortcut without adding a global listener. */
export function installViewportKeyboard(
  target: EventTarget | undefined,
  fitSelection: () => void,
): () => void {
  if (target === undefined) return () => {};
  const keyDown = (event: Event): void => {
    const keyboard = event as KeyboardEvent;
    if (
      keyboard.key.toLowerCase() !== "z" ||
      keyboard.repeat ||
      keyboard.ctrlKey ||
      keyboard.metaKey ||
      keyboard.altKey ||
      isEditableTarget(keyboard.target)
    ) {
      return;
    }
    keyboard.preventDefault();
    fitSelection();
  };
  target.addEventListener("keydown", keyDown);
  return () => {
    target.removeEventListener("keydown", keyDown);
  };
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (target === null || typeof target !== "object") return false;
  const element = target as EventTarget & {
    readonly isContentEditable?: boolean;
    readonly tagName?: string;
  };
  const tagName = element.tagName?.toLowerCase();
  return (
    element.isContentEditable === true ||
    tagName === "input" ||
    tagName === "textarea" ||
    tagName === "select"
  );
}

/** Validates the host relationship before renderer or overlay setup begins. */
export function validateOrientationGizmo(
  canvas: HTMLCanvasElement,
  orientationGizmo: OrientationGizmoOptions | undefined,
): void {
  if (orientationGizmo === undefined) return;
  if (
    orientationGizmo.container === canvas ||
    typeof orientationGizmo.container.contains !== "function" ||
    !orientationGizmo.container.contains(canvas)
  ) {
    throw new Error("FemViewport orientationGizmo.container must contain the canvas");
  }
}
