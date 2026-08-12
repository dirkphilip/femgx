import type { OrientationGizmoOptions } from "./orientation-gizmo";

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
