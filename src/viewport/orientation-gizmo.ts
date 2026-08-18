import type { Camera } from "../camera/camera";
import type { ViewCubeAction } from "../camera/view-cube";
import {
  createOrientationGizmoElements,
  updateOrientationGizmoElements,
} from "./orientation-gizmo-svg";

/**
 * Host element that receives femgx's interactive view cube.
 * @category Viewport lifecycle
 */
export interface OrientationGizmoOptions {
  /** DOM element that receives the renderer-owned orientation gizmo. */
  readonly container: HTMLElement;
}

/** Internal lifecycle handle for one viewport-owned view cube. */
export interface OrientationGizmoHandle {
  update(camera: Camera): void;
  destroy(): void;
}

/** Creates one retained view cube and owns its container-position lifecycle. */
export function createOrientationGizmo(
  options: OrientationGizmoOptions,
  onAction: (action: ViewCubeAction) => void = () => undefined,
): OrientationGizmoHandle {
  let destroyed = false;
  const elements = createOrientationGizmoElements((action) => {
    if (!destroyed) onAction(action);
  });
  const originalPosition = options.container.style.position;
  const computedPosition =
    typeof getComputedStyle === "undefined"
      ? originalPosition
      : getComputedStyle(options.container).position;
  const ownsPosition = computedPosition === "static" || computedPosition === "";
  if (ownsPosition) options.container.style.position = "relative";
  options.container.appendChild(elements.root);

  return {
    update: (camera) => {
      if (destroyed) return;
      updateOrientationGizmoElements(elements, camera);
    },
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      elements.root.remove();
      if (ownsPosition && options.container.style.position === "relative") {
        options.container.style.position = originalPosition;
      }
    },
  };
}
