import { createCamera, resizeCamera, type Camera } from "../../camera/camera";
import { createInteractionState } from "../../interaction/interaction";
import type { WebGpuRenderer } from "../../renderer/gpu-renderer";
import { changedInstanceSlots } from "../interaction-diff";
import type { SceneOccurrences } from "../../scene-runtime/occurrences";
import type { Scene } from "../../scene/scene";
import type { SceneUpdate } from "../../scene/update";
import { SceneNavigationBoundsCache } from "../scene-bounds";
import { cssSize, installViewportCanvasBindings } from "../dom";
import { CameraFocusController } from "../camera-focus";
import type {
  Viewport,
  ViewportOptions,
  SceneUpdateOutcome,
  ViewportInteraction,
  ViewportPresentation,
  ViewportResults,
  ViewportView,
  ViewportVisibility,
  ViewportStats,
} from "../types";
import { createViewportCapabilities } from "../capabilities";
import { ViewportSceneController } from "../scene-controller";
import { ViewportVisibilityController } from "../visibility-controller";
import { ViewportLifecycleController } from "./lifecycle-controller";

/** Owns one fully initialized viewport and its internal lifecycle resources. */
export class ViewportCore implements Viewport {
  private readonly cameraRef: { camera: Camera };
  private appliedInteraction = createInteractionState();
  private readonly cameraFocus: CameraFocusController;
  private readonly sceneController: ViewportSceneController;
  private readonly visibilityController: ViewportVisibilityController;
  private readonly lifecycle: ViewportLifecycleController;
  readonly view: ViewportView;
  readonly interaction: ViewportInteraction;
  readonly visibility: ViewportVisibility;
  readonly results: ViewportResults;
  readonly presentation: ViewportPresentation;
  private readonly navigationBoundsCache = new SceneNavigationBoundsCache();

  constructor(
    private readonly options: ViewportOptions,
    private readonly renderer: WebGpuRenderer,
  ) {
    let bindings: ReturnType<typeof installViewportCanvasBindings> | undefined;
    let lifecycle: ViewportLifecycleController | undefined;
    let cameraFocus: CameraFocusController | undefined;
    try {
      this.cameraRef = { camera: options.camera ?? createCamera() };
      this.sceneController = new ViewportSceneController({
        scene: options.scene,
        interaction: options.interaction,
        renderer,
      });
      const navigationBounds = () =>
        this.navigationBoundsCache.get(
          this.sceneController.scene,
          this.sceneController.runtime,
          this.sceneController.results?.deformation,
        );
      cameraFocus = this.createCameraFocus(options);
      this.cameraFocus = cameraFocus;
      bindings = this.createCanvasBindings(options, renderer, navigationBounds);
      lifecycle = this.createLifecycle(options, bindings);
      this.lifecycle = lifecycle;
      const initialized = this.initializeCapabilities(renderer);
      this.visibilityController = initialized.visibilityController;
      const capabilities = initialized.capabilities;
      this.view = capabilities.view;
      this.interaction = capabilities.interaction;
      this.visibility = capabilities.visibility;
      this.results = capabilities.results;
      this.presentation = capabilities.presentation;
      this.resize(false);
      if (options.results !== undefined) this.sceneController.setResults(options.results);
      if (options.camera === undefined) {
        this.cameraFocus.fitView(undefined, false);
      }
      this.render();
    } catch (error) {
      if (lifecycle === undefined) {
        bindings?.orientationGizmo?.destroy();
        bindings?.removeResize();
        bindings?.removeControls();
        bindings?.removeKeyboard();
        cameraFocus?.dispose();
        renderer.destroy();
      } else {
        lifecycle.destroy();
      }
      throw error;
    }
  }

  private createCanvasBindings(
    options: ViewportOptions,
    renderer: WebGpuRenderer,
    navigationBounds: () => ReturnType<SceneNavigationBoundsCache["get"]>,
  ): ReturnType<typeof installViewportCanvasBindings> {
    return installViewportCanvasBindings({
      options,
      renderer,
      cameraRef: this.cameraRef,
      navigationBounds,
      fitSelection: () => {
        this.lifecycle.ensureAlive();
        this.cameraFocus.fitSelection(undefined);
      },
      invalidate: () => {
        this.invalidate();
      },
      resize: () => {
        this.resize();
      },
      onGestureChange: (active) => {
        if (active) this.cameraFocus.interrupt();
        options.onGestureChange?.(active);
      },
      onOrientationAction: (action) => {
        this.lifecycle.ensureAlive();
        this.cameraFocus.applyOrientationAction(action);
      },
    });
  }

  private initializeCapabilities(renderer: WebGpuRenderer): {
    readonly visibilityController: ViewportVisibilityController;
    readonly capabilities: ReturnType<typeof createViewportCapabilities>;
  } {
    const visibilityController = new ViewportVisibilityController({
      viewport: this,
      sceneController: this.sceneController,
      renderer,
      lifecycle: this.lifecycle,
      navigationBoundsCache: this.navigationBoundsCache,
    });
    return {
      visibilityController,
      capabilities: createViewportCapabilities({
        cameraRef: this.cameraRef,
        cameraFocus: this.cameraFocus,
        sceneController: this.sceneController,
        renderer,
        lifecycle: this.lifecycle,
        visibilityController,
        presentation: {
          background: this.options.background ?? "studio",
          pointSizePixels: this.options.pointSizePixels ?? 8,
          nodeSizePixels: this.options.nodeSizePixels ?? 6,
        },
      }),
    };
  }

  private createLifecycle(
    options: ViewportOptions,
    bindings: ReturnType<typeof installViewportCanvasBindings>,
  ): ViewportLifecycleController {
    return new ViewportLifecycleController({
      renderer: this.renderer,
      cameraFocus: this.cameraFocus,
      removeControls: bindings.removeControls,
      removeResize: bindings.removeResize,
      removeKeyboard: bindings.removeKeyboard,
      orientationGizmo: bindings.orientationGizmo,
      resetInteraction: () => {
        this.appliedInteraction = createInteractionState();
      },
      render: this.renderFrame.bind(this),
      onRecovered: options.onRecovered,
      onError: options.onError,
    });
  }

  private createCameraFocus(options: ViewportOptions): CameraFocusController {
    return new CameraFocusController({
      cameraRef: this.cameraRef,
      canvas: options.canvas,
      sceneController: this.sceneController,
      navigationBoundsCache: this.navigationBoundsCache,
      ...(options.fitContentInset === undefined
        ? {}
        : { fitContentInset: options.fitContentInset }),
      invalidate: () => {
        this.lifecycle.invalidate();
      },
    });
  }

  get scene(): Scene {
    return this.sceneController.scene;
  }
  get occurrences(): SceneOccurrences {
    return this.sceneController.publicRuntime;
  }
  replaceScene(scene: Scene): void {
    this.lifecycle.ensureAlive();
    this.sceneController.replaceScene(scene, () => {
      this.cameraFocus.cancel();
    });
    this.visibilityController.reset();
    this.appliedInteraction = createInteractionState();
    this.lifecycle.invalidate();
  }

  updateScene(operation: (update: SceneUpdate) => void): SceneUpdateOutcome {
    this.lifecycle.ensureAlive();
    const cancelCamera = (): void => {
      this.cameraFocus.cancel();
    };
    const update = this.sceneController.updateScene(operation, cancelCamera);
    if (!update.committed) return update.outcome;
    this.visibilityController.reset();
    if (!update.rendererSynchronized) this.appliedInteraction = createInteractionState();
    if (update.requiresRender !== false) this.lifecycle.invalidate();
    return update.outcome;
  }

  batch<T>(operation: () => T): T {
    this.lifecycle.ensureAlive();
    return this.lifecycle.batch(operation, () => {
      this.visibilityController.flush();
    });
  }

  resize(invalidate = true): void {
    this.lifecycle.ensureAlive();
    const policy = this.cameraFocus.resizePolicy;
    if (policy !== "preserve") this.cameraFocus.cancel();
    const size = cssSize(this.options.canvas);
    this.renderer.resize(size.width, size.height);
    this.cameraRef.camera = resizeCamera(this.cameraRef.camera, size.width, size.height);
    if (policy === "refit") this.cameraFocus.fitView(undefined, false);
    if (invalidate) this.lifecycle.invalidate();
  }
  invalidate(): void {
    this.lifecycle.ensureAlive();
    this.lifecycle.invalidate();
  }

  render(): void {
    this.lifecycle.ensureAlive();
    this.renderFrame();
  }

  private renderFrame(): void {
    if (this.lifecycle.isBatching) {
      this.lifecycle.markDirty();
      return;
    }
    const runtime = this.sceneController.runtime;
    const interaction = this.sceneController.rendererInteraction;
    const interactionChanged = this.appliedInteraction !== interaction;
    const changed = interactionChanged
      ? changedInstanceSlots(runtime, this.appliedInteraction, interaction)
      : [];
    if (interactionChanged) this.renderer.syncInteraction(runtime, interaction, changed);
    this.lifecycle.updateOrientationGizmo(this.cameraRef.camera);
    this.renderer.render(
      runtime,
      this.cameraRef.camera,
      this.sceneController.scene.parts,
      this.sceneController.originTriadScale,
    );
    this.appliedInteraction = interaction;
    this.options.onRender?.();
  }

  recover(): Promise<void> {
    return this.lifecycle.recover();
  }
  handleDeviceLoss(): void {
    this.lifecycle.handleDeviceLoss();
  }

  destroy(): void {
    this.lifecycle.destroy();
  }
  stats(): ViewportStats {
    return {
      visiblePartOccurrences: this.sceneController.runtime.visibleCount,
      drawBatches: this.renderer.stats().drawBatches,
    };
  }
}
