import { assertValidCamera, type Camera } from "../camera/camera";
import { centerCameraOnBounds, fitCamera, type CameraContentInset } from "../camera/fit";
import type { CameraRef } from "../camera/controls";
import { applyViewCubeAction, type ViewCubeAction } from "../camera/view-cube";
import { type Bounds } from "../geometry/part";
import { selectedTargets } from "../interaction/targets";
import {
  createCameraTransition,
  interpolateCamera,
  interpolateOrientationCamera,
  type CameraTransitionInterpolator,
} from "./camera-transition";
import { cssSize } from "./dom";
import { padDegenerateBounds } from "./geometry-bounds";
import { selectedSceneBounds, type SceneNavigationBoundsCache } from "./scene-bounds";
import type { CameraTransitionOptions } from "./types";
import type { ViewportSceneController } from "./scene-controller";

export interface CameraFocusOptions {
  readonly cameraRef: CameraRef;
  readonly canvas: HTMLCanvasElement;
  readonly sceneController: ViewportSceneController;
  readonly navigationBoundsCache: SceneNavigationBoundsCache;
  readonly fitContentInset?: () => CameraContentInset;
  readonly invalidate: () => void;
}

const DEFAULT_CAMERA_TRANSITION_DURATION_MS = 400;

/** Owns the viewport's single interruptible camera-focus path. */
export class CameraFocusController {
  private readonly transition = createCameraTransition();
  private resizeCameraPolicy: "interrupt" | "preserve" | "refit" = "interrupt";

  constructor(private readonly options: CameraFocusOptions) {}

  setCamera(
    camera: Camera,
    transitionOptions: CameraTransitionOptions | undefined,
    interpolate: CameraTransitionInterpolator = interpolateCamera,
  ): void {
    assertValidCamera(camera);
    this.resizeCameraPolicy = "interrupt";
    const duration = resolveDuration(transitionOptions, 0);
    this.transition.cancel();
    this.apply(camera, duration, true, interpolate);
  }

  fitView(transitionOptions: CameraTransitionOptions | undefined, invalidate: boolean): void {
    this.resizeCameraPolicy = "refit";
    const duration = resolveDuration(transitionOptions, 0);
    this.transition.cancel();
    const bounds = this.navigationBounds();
    const target = fitCameraForBounds(
      this.options.cameraRef.camera,
      bounds.bounds,
      this.options.canvas,
      this.options.fitContentInset?.(),
    );
    this.apply(target, duration, invalidate);
  }

  fitSelection(transitionOptions: CameraTransitionOptions | undefined, invalidate = true): void {
    this.resizeCameraPolicy = "interrupt";
    const duration = resolveDuration(transitionOptions, DEFAULT_CAMERA_TRANSITION_DURATION_MS);
    this.transition.cancel();
    const scene = this.options.sceneController.scene;
    const runtime = this.options.sceneController.runtime;
    const deformation = this.options.sceneController.results?.deformation;
    const sceneBounds = this.navigationBounds().bounds;
    const targets = selectedTargets(this.options.sceneController.interaction);
    const selectedBounds = selectedSceneBounds(
      scene,
      runtime,
      this.options.sceneController.interaction,
      deformation,
    );
    let fitBounds = sceneBounds;
    if (targets.length > 0) {
      if (selectedBounds === undefined) return;
      fitBounds = padDegenerateBounds(selectedBounds, sceneBounds);
    }
    const contentInset = this.options.fitContentInset?.();
    const fitted = fitCameraForBounds(
      this.options.cameraRef.camera,
      fitBounds,
      this.options.canvas,
      contentInset,
    );
    const target = centerCameraOnBounds(this.protect(fitted), fitBounds, contentInset);
    this.apply(target, duration, invalidate);
  }

  cancel(): void {
    this.transition.cancel();
  }

  interrupt(): void {
    this.resizeCameraPolicy = "interrupt";
    this.transition.cancel();
  }

  get resizePolicy(): "interrupt" | "preserve" | "refit" {
    return this.resizeCameraPolicy;
  }

  dispose(): void {
    this.cancel();
  }

  applyOrientationAction(action: ViewCubeAction): void {
    this.resizeCameraPolicy = "preserve";
    const camera = applyViewCubeAction(
      this.options.cameraRef.camera,
      this.navigationBounds().bounds,
      action,
    );
    const duration = resolveDuration(
      { durationMs: DEFAULT_CAMERA_TRANSITION_DURATION_MS },
      DEFAULT_CAMERA_TRANSITION_DURATION_MS,
    );
    this.transition.cancel();
    this.apply(camera, duration, true, interpolateOrientationCamera);
  }

  private apply(
    camera: Camera,
    durationMs: number,
    invalidate = true,
    interpolate: CameraTransitionInterpolator = interpolateCamera,
  ): void {
    const target = this.protect(camera);
    if (durationMs === 0) {
      this.options.cameraRef.camera = target;
      if (invalidate) this.options.invalidate();
      return;
    }
    let appliedSize = {
      width: this.options.cameraRef.camera.width,
      height: this.options.cameraRef.camera.height,
    };
    let resizedSize: typeof appliedSize | undefined;
    const update = (next: Camera, complete: boolean): void => {
      const current = this.options.cameraRef.camera;
      if (current.width !== appliedSize.width || current.height !== appliedSize.height) {
        resizedSize = { width: current.width, height: current.height };
      }
      const sized = resizedSize === undefined ? next : { ...next, ...resizedSize };
      this.options.cameraRef.camera = complete ? sized : this.protect(sized);
      appliedSize = {
        width: this.options.cameraRef.camera.width,
        height: this.options.cameraRef.camera.height,
      };
      this.options.invalidate();
    };
    this.transition.start(this.options.cameraRef.camera, target, durationMs, update, interpolate);
  }

  private navigationBounds() {
    return this.options.navigationBoundsCache.get(
      this.options.sceneController.scene,
      this.options.sceneController.runtime,
      this.options.sceneController.results?.deformation,
    );
  }

  private protect(camera: Camera): Camera {
    return this.options.navigationBoundsCache.protect(
      camera,
      this.options.sceneController.scene,
      this.options.sceneController.runtime,
      this.options.sceneController.results?.deformation,
    );
  }
}

function fitCameraForBounds(
  camera: Camera,
  bounds: Bounds,
  canvas: HTMLCanvasElement,
  contentInset: CameraContentInset | undefined,
): Camera {
  const size = cssSize(canvas);
  return fitCamera(camera, bounds, size.width, size.height, contentInset);
}

function resolveDuration(
  options: CameraTransitionOptions | undefined,
  defaultDuration: number,
): number {
  const value = options?.durationMs ?? defaultDuration;
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError("Camera transition durationMs must be finite and non-negative");
  }
  return prefersReducedMotion() ? 0 : value;
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
