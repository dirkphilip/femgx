import { createCamera, resizeCamera, type Camera } from "../../camera/camera";
import { createInteractionState, type InteractionState } from "../../interaction/interaction";
import type { BoxSelectionRect } from "../../interaction/box-selection";
import type { WebGpuRenderer } from "../../renderer/gpu-renderer";
import { changedInstanceSlots } from "../interaction-diff";
import type { SceneOccurrences } from "../../scene-runtime/occurrences";
import type { Scene } from "../../scene/scene";
import type { SceneUpdate } from "../../scene/update";
import type { InteractionGranularity, PickHit } from "../../picking/types";
import { SceneNavigationBoundsCache } from "../scene-bounds";
import {
  assertPixelSize,
  assertViewportBackground,
  cssSize,
  installViewportCanvasBindings,
} from "../dom";
import { CameraFocusController } from "../camera-focus";
import { normalizeSectionPlane, type SectionPlane } from "../../math/section-plane";
import type { DeformationState } from "../../results/deform";
import type { ViewportResultsConfig } from "../results";
import type {
  CameraTransitionOptions,
  Viewport,
  ViewportOptions,
  SceneUpdateOutcome,
  ViewportBackground,
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
  private currentSectionPlane: SectionPlane | undefined;
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
  private resizeCameraPolicy: "interrupt" | "preserve" | "refit" = "interrupt";
  private background: ViewportBackground;
  private pointSizePixels: number;
  private nodeSizePixels: number;
  private readonly navigationBoundsCache = new SceneNavigationBoundsCache();

  constructor(
    private readonly options: ViewportOptions,
    private readonly renderer: WebGpuRenderer,
  ) {
    this.background = options.background ?? "studio";
    this.pointSizePixels = options.pointSizePixels ?? 8;
    this.nodeSizePixels = options.nodeSizePixels ?? 6;
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
      const deformation = () => this.sceneController.results?.deformation;
      const navigationBounds = () =>
        this.navigationBoundsCache.get(
          this.sceneController.scene,
          this.sceneController.runtime,
          deformation(),
        );
      cameraFocus = this.createCameraFocus(options, deformation);
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
        this.resizeCameraPolicy = "refit";
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
      fitSelection: this.fitSelection.bind(this),
      invalidate: this.invalidate.bind(this),
      resize: this.resize.bind(this),
      onGestureChange: (active) => {
        if (active) {
          this.resizeCameraPolicy = "interrupt";
          this.cameraFocus.cancel();
        }
        options.onGestureChange?.(active);
      },
      onOrientationAction: (action) => {
        this.resizeCameraPolicy = "preserve";
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
      isBatching: () => this.lifecycle.isBatching,
      invalidate: this.invalidate.bind(this),
      navigationBoundsCache: this.navigationBoundsCache,
    });
    return {
      visibilityController,
      capabilities: this.createCapabilities(visibilityController),
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
      render: this.render.bind(this),
      onRecovered: options.onRecovered,
      onError: options.onError,
    });
  }

  private createCapabilities(
    visibilityController: ViewportVisibilityController,
  ): ReturnType<typeof createViewportCapabilities> {
    return createViewportCapabilities({
      ensureAlive: this.ensureAlive.bind(this),
      camera: () => this.cameraRef.camera,
      setCamera: this.setCamera.bind(this),
      fit: this.fitView.bind(this),
      fitSelection: this.fitSelection.bind(this),
      state: () => this.sceneController.interaction,
      set: this.setInteraction.bind(this),
      pick: this.pick.bind(this),
      pickRegion: this.pickRegion.bind(this),
      visibilityController,
      resultsState: () => this.sceneController.results,
      setResults: this.setResults.bind(this),
      clearResults: this.clearResults.bind(this),
      sectionPlane: () => this.currentSectionPlane,
      setSectionPlane: this.setSectionPlane.bind(this),
      clearSectionPlane: this.clearSectionPlane.bind(this),
      setBackground: this.setBackground.bind(this),
      setPointSizePixels: this.setPointSizePixels.bind(this),
      setNodeSizePixels: this.setNodeSizePixels.bind(this),
      setEdgeDepthTest: this.setEdgeDepthTest.bind(this),
      setEdgesVisible: this.setEdgesVisible.bind(this),
      setNodesVisible: this.setNodesVisible.bind(this),
    });
  }

  private createCameraFocus(
    options: ViewportOptions,
    deformation: () => DeformationState | undefined,
  ): CameraFocusController {
    return new CameraFocusController({
      cameraRef: this.cameraRef,
      canvas: options.canvas,
      scene: () => this.sceneController.scene,
      runtime: () => this.sceneController.runtime,
      interaction: () => this.sceneController.interaction,
      deformation,
      ...(options.fitContentInset === undefined
        ? {}
        : { fitContentInset: options.fitContentInset }),
      invalidate: this.invalidate.bind(this),
    });
  }

  get scene(): Scene {
    return this.sceneController.scene;
  }
  get occurrences(): SceneOccurrences {
    return this.sceneController.publicRuntime;
  }
  replaceScene(scene: Scene): void {
    this.ensureAlive();
    this.sceneController.replaceScene(scene, this.cameraFocus.cancel.bind(this.cameraFocus));
    this.visibilityController.reset();
    this.appliedInteraction = createInteractionState();
    this.invalidate();
  }

  updateScene(operation: (update: SceneUpdate) => void): SceneUpdateOutcome {
    this.ensureAlive();
    const cancelCamera = this.cameraFocus.cancel.bind(this.cameraFocus);
    const update = this.sceneController.updateScene(operation, cancelCamera);
    if (!update.committed) return update.outcome;
    this.visibilityController.reset();
    if (!update.rendererSynchronized) this.appliedInteraction = createInteractionState();
    if (update.requiresRender !== false) this.invalidate();
    return update.outcome;
  }

  private setCamera(camera: Camera, transitionOptions?: CameraTransitionOptions): void {
    this.ensureAlive();
    this.resizeCameraPolicy = "interrupt";
    this.cameraFocus.setCamera(camera, transitionOptions);
  }

  private fitView(transitionOptions?: CameraTransitionOptions): void {
    this.ensureAlive();
    this.resizeCameraPolicy = "refit";
    this.cameraFocus.fitView(transitionOptions, true);
  }

  private fitSelection(transitionOptions?: CameraTransitionOptions): void {
    this.ensureAlive();
    this.resizeCameraPolicy = "interrupt";
    this.cameraFocus.fitSelection(transitionOptions);
  }

  private setInteraction(interaction: InteractionState): void {
    this.ensureAlive();
    this.sceneController.setInteraction(interaction);
    this.invalidate();
  }

  batch<T>(operation: () => T): T {
    this.ensureAlive();
    return this.lifecycle.batch(
      operation,
      this.visibilityController.flush.bind(this.visibilityController),
    );
  }

  private setResults(results: ViewportResultsConfig): void {
    this.ensureAlive();
    this.sceneController.setResults(results);
    this.invalidate();
  }

  private clearResults(): void {
    this.ensureAlive();
    this.sceneController.clearResults();
    this.invalidate();
  }

  private setSectionPlane(plane: SectionPlane): void {
    this.ensureAlive();
    const normalized = normalizeSectionPlane(plane);
    this.currentSectionPlane = normalized;
    this.renderer.setSectionPlane(normalized);
    this.invalidate();
  }

  private clearSectionPlane(): void {
    this.ensureAlive();
    if (this.currentSectionPlane === undefined) return;
    this.currentSectionPlane = undefined;
    this.renderer.setSectionPlane(undefined);
    this.invalidate();
  }

  private setBackground(background: ViewportBackground): void {
    this.ensureAlive();
    assertViewportBackground(background);
    if (this.background === background) return;
    this.background = background;
    this.renderer.setBackground(background);
    this.invalidate();
  }

  private setPointSizePixels(size: number): void {
    this.ensureAlive();
    assertPixelSize("pointSizePixels", size);
    if (this.pointSizePixels === size) return;
    this.renderer.setPointSizePixels(size);
    this.pointSizePixels = size;
    this.invalidate();
  }

  private setNodeSizePixels(size: number): void {
    this.ensureAlive();
    assertPixelSize("nodeSizePixels", size);
    if (this.nodeSizePixels === size) return;
    this.renderer.setNodeSizePixels(size);
    this.nodeSizePixels = size;
    this.invalidate();
  }

  private setEdgeDepthTest(enabled: boolean): void {
    this.ensureAlive();
    this.renderer.setEdgeDepthTest(enabled);
    this.invalidate();
  }

  private setEdgesVisible(enabled: boolean): void {
    this.ensureAlive();
    this.renderer.setEdgesVisible(enabled);
    this.invalidate();
  }

  private setNodesVisible(enabled: boolean): void {
    this.ensureAlive();
    this.renderer.setNodesVisible(enabled);
    this.invalidate();
  }

  private pick(x: number, y: number, granularity?: "edge"): Promise<PickHit | undefined> {
    this.ensureAlive();
    return this.renderer.pick(x, y, granularity);
  }
  private pickRegion(rect: BoxSelectionRect, granularity: InteractionGranularity) {
    this.ensureAlive();
    return this.renderer.pickRegion(rect, granularity);
  }
  resize(invalidate = true): void {
    this.ensureAlive();
    const policy = this.resizeCameraPolicy;
    if (policy !== "preserve") this.cameraFocus.cancel();
    const size = cssSize(this.options.canvas);
    this.renderer.resize(size.width, size.height);
    this.cameraRef.camera = resizeCamera(this.cameraRef.camera, size.width, size.height);
    if (policy === "refit") this.cameraFocus.fitView(undefined, false);
    if (invalidate) this.invalidate();
  }
  invalidate(): void {
    this.ensureAlive();
    this.lifecycle.invalidate();
  }

  render(): void {
    this.ensureAlive();
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

  private ensureAlive(): void {
    this.lifecycle.ensureAlive();
  }
}
