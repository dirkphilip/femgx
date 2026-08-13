import { assertValidCamera, type Camera } from "../camera/camera";
import { fitCamera, type CameraContentInset } from "../camera/fit";
import type { CameraRef } from "../camera/controls";
import { applyViewCubeAction, type ViewCubeAction } from "../camera/view-cube";
import { type Bounds } from "../geometry/part";
import type { InteractionState } from "../interaction/interaction";
import { selectedTargets } from "../interaction/targets";
import type { DeformationState } from "../results/deform";
import { createCameraTransition } from "./camera-transition";
import { cssSize } from "./dom";
import { padDegenerateBounds } from "./geometry-bounds";
import { protectSceneCamera, sceneWorldBounds, selectedSceneBounds } from "./scene-bounds";
import type { CameraTransitionOptions } from "./types";
import type { PackedSceneRuntime } from "../scene-runtime/runtime";
import type { Scene } from "../scene/scene";

export interface CameraFocusOptions {
  readonly cameraRef: CameraRef;
  readonly canvas: HTMLCanvasElement;
  readonly scene: () => Scene;
  readonly runtime: () => PackedSceneRuntime;
  readonly interaction: () => InteractionState;
  readonly deformation: () => DeformationState | undefined;
  readonly fitContentInset?: () => CameraContentInset;
  readonly invalidate: () => void;
}

const FIT_SELECTION_DURATION_MS = 400;

/** Owns the viewport's single interruptible camera-focus path. */
export class CameraFocusController {
  private readonly transition = createCameraTransition();

  constructor(private readonly options: CameraFocusOptions) {}

  setCamera(camera: Camera, transitionOptions: CameraTransitionOptions | undefined): void {
    assertValidCamera(camera);
    const duration = resolveDuration(transitionOptions, 0);
    this.transition.cancel();
    this.apply(camera, duration);
  }

  fitView(transitionOptions: CameraTransitionOptions | undefined, invalidate: boolean): void {
    const duration = resolveDuration(transitionOptions, 0);
    this.transition.cancel();
    const target = fitCameraForBounds(
      this.options.cameraRef.camera,
      sceneWorldBounds(this.options.scene(), this.options.runtime(), this.options.deformation()),
      this.options.canvas,
      this.options.fitContentInset?.(),
    );
    this.apply(target, duration, invalidate);
  }

  fitSelection(transitionOptions: CameraTransitionOptions | undefined, invalidate = true): void {
    const duration = resolveDuration(transitionOptions, FIT_SELECTION_DURATION_MS);
    this.transition.cancel();
    const scene = this.options.scene();
    const runtime = this.options.runtime();
    const deformation = this.options.deformation();
    const sceneBounds = sceneWorldBounds(scene, runtime, deformation);
    const targets = selectedTargets(this.options.interaction());
    const selectedBounds = selectedSceneBounds(
      scene,
      runtime,
      this.options.interaction(),
      deformation,
    );
    let fitBounds = sceneBounds;
    if (targets.length > 0) {
      if (selectedBounds === undefined) return;
      fitBounds = padDegenerateBounds(selectedBounds, sceneBounds);
    }
    const target = fitCameraForBounds(
      this.options.cameraRef.camera,
      fitBounds,
      this.options.canvas,
      this.options.fitContentInset?.(),
    );
    this.apply(target, duration, invalidate);
  }

  cancel(): void {
    this.transition.cancel();
  }

  dispose(): void {
    this.cancel();
  }

  applyOrientationAction(action: ViewCubeAction): void {
    const camera = applyViewCubeAction(
      this.options.cameraRef.camera,
      sceneWorldBounds(this.options.scene(), this.options.runtime(), this.options.deformation()),
      action,
    );
    this.setCamera(camera, undefined);
  }

  private apply(camera: Camera, durationMs: number, invalidate = true): void {
    const scene = this.options.scene();
    const runtime = this.options.runtime();
    const target = protectSceneCamera(camera, scene, runtime, this.options.deformation());
    if (durationMs === 0) {
      this.options.cameraRef.camera = target;
      if (invalidate) this.options.invalidate();
      return;
    }
    const update = (next: Camera, complete: boolean): void => {
      this.options.cameraRef.camera = complete
        ? target
        : protectSceneCamera(
            next,
            this.options.scene(),
            this.options.runtime(),
            this.options.deformation(),
          );
      this.options.invalidate();
    };
    this.transition.start(this.options.cameraRef.camera, target, durationMs, update);
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
