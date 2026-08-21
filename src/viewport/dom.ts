import type { OrientationGizmoOptions } from "./orientation-gizmo";
import { createOrientationGizmo, type OrientationGizmoHandle } from "./orientation-gizmo";
import type { CameraRef } from "../camera/controls";
import { installCameraControlsWithProtectedBounds } from "../camera/controls";
import type { ViewCubeAction } from "../camera/view-cube";
import type { SceneNavigationBounds } from "./scene-bounds";
import type { WebGpuRenderer } from "../renderer/gpu-renderer";
import type { ViewportBackground, ViewportOptions } from "./types";

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
    if (!("key" in event) || typeof event.key !== "string") return;
    const repeat = "repeat" in event && event.repeat === true;
    const ctrlKey = "ctrlKey" in event && event.ctrlKey === true;
    const metaKey = "metaKey" in event && event.metaKey === true;
    const altKey = "altKey" in event && event.altKey === true;
    if (
      event.key.toLowerCase() !== "z" ||
      repeat ||
      ctrlKey ||
      metaKey ||
      altKey ||
      isEditableTarget(event.target)
    ) {
      return;
    }
    event.preventDefault();
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
    throw new Error("Viewport orientationGizmo.container must contain the canvas");
  }
}

/** Validates a renderer-owned screen-space size in CSS pixels. */
export function assertPixelSize(name: string, value: number | undefined): void {
  if (value === undefined) return;
  if (!Number.isFinite(value) || value < 1 || value > 64) {
    throw new RangeError(`${name} must be finite and in [1, 64] CSS pixels`);
  }
}

/** Resources installed around one viewport canvas and released with its lifecycle. */
export interface ViewportCanvasBindings {
  readonly removeControls: () => void;
  readonly removeResize: () => void;
  readonly removeKeyboard: () => void;
  readonly orientationGizmo: OrientationGizmoHandle | undefined;
}

interface ViewportCanvasBindingOptions {
  readonly options: ViewportOptions;
  readonly renderer: WebGpuRenderer;
  readonly cameraRef: CameraRef;
  readonly navigationBounds: () => SceneNavigationBounds;
  readonly fitSelection: () => void;
  readonly invalidate: () => void;
  readonly resize: () => void;
  readonly onGestureChange: (active: boolean) => void;
  readonly onOrientationAction: (action: ViewCubeAction) => void;
}

/** Installs camera, resize, keyboard, and optional orientation-gizmo bindings. */
export function installViewportCanvasBindings(
  bindingOptions: ViewportCanvasBindingOptions,
): ViewportCanvasBindings {
  const { options, renderer, navigationBounds } = bindingOptions;
  let removeKeyboard = (): void => undefined;
  let removeControls = (): void => undefined;
  let removeResize = (): void => undefined;
  let orientationGizmo: OrientationGizmoHandle | undefined;
  try {
    removeKeyboard = installViewportKeyboard(options.keyboardTarget, bindingOptions.fitSelection);
    removeControls = installCameraControlsWithProtectedBounds({
      canvas: options.canvas,
      cameraRef: bindingOptions.cameraRef,
      navigation: renderer,
      bounds: () => navigationBounds().bounds,
      protectedBounds: () => navigationBounds().protectedBounds,
      onRender: bindingOptions.invalidate,
      onGestureChange: bindingOptions.onGestureChange,
    });
    removeResize = installResize(options.canvas, bindingOptions.resize);
    orientationGizmo =
      options.orientationGizmo === undefined
        ? undefined
        : createOrientationGizmo(options.orientationGizmo, bindingOptions.onOrientationAction);
    return { removeControls, removeResize, removeKeyboard, orientationGizmo };
  } catch (error) {
    orientationGizmo?.destroy();
    removeResize();
    removeControls();
    removeKeyboard();
    throw error;
  }
}
