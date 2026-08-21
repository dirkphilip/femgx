import { createCamera, resizeCamera, type Camera } from "../camera/camera";
import { createInteractionState, type InteractionState } from "../interaction/interaction";
import type { BoxSelectionRect } from "../interaction/box-selection";
import type { DeviceLostInfo } from "../platform/device";
import { createWebGpuRenderer, type WebGpuRenderer } from "../renderer/gpu-renderer";
import { changedInstanceSlots } from "./interaction-diff";
import type { SceneOccurrences } from "../scene-runtime/occurrences";
import type { Scene } from "../scene/scene";
import type { SceneUpdate } from "../scene/update";
import type { InteractionGranularity, PickHit } from "../picking/types";
import { SceneNavigationBoundsCache } from "./scene-bounds";
import {
  assertPixelSize,
  assertViewportBackground,
  cssSize,
  installViewportCanvasBindings,
  validateOrientationGizmo,
} from "./dom";
import { CameraFocusController } from "./camera-focus";
import { normalizeSectionPlane, type SectionPlane } from "../math/section-plane";
import { assertOriginTriad } from "./bounds/origin-triad";
import type { DeformationState } from "../results/deform";
import type { ViewportResultsConfig } from "./results";
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
} from "./types";
import { createViewportCapabilities } from "./capabilities";
import { ViewportSceneController } from "./scene-controller";
import { ViewportVisibilityController } from "./visibility-controller";
import { ViewportLifecycleController } from "./lifecycle-controller";
export type {
  Viewport,
  ViewportInteraction,
  ViewportOptions,
  ViewportPresentation,
  ViewportResults,
  ViewportView,
  ViewportVisibility,
  SceneUpdateOutcome,
  ViewportBackground,
  ViewportStats,
} from "./types";

/**
 * Creates a fitted, interactive FEM viewport backed only by WebGPU.
 *
 * This asynchronous factory requests the supported-path adapter/device,
 * compiles the supplied {@link root.Scene}, creates a fitted camera, installs
 * standard canvas controls and resize synchronization, and returns the sole
 * public lifecycle owner. It rejects with {@link root.WebGpuUnsupportedError} when
 * the browser cannot provide a working WebGPU device; there is no CPU renderer
 * fallback. A device loss can be reported through `onDeviceLost` and recovered
 * with {@link root.Viewport.recover}.
 * @example Create and destroy a viewport.
 * ```ts
 * import { createViewport, createPart, createSceneBuilder, identityMatrix } from "femgx";
 *
 * const canvas = document.querySelector<HTMLCanvasElement>("#viewport");
 * if (canvas === null) throw new Error("Missing #viewport canvas");
 * const part = createPart(1, {
 *   geometries: [{
 *     primitive: "points",
 *     positions: new Float32Array([0, 0, 0]),
 *     indices: new Uint32Array([0]),
 *   }],
 * });
 * const scene = createSceneBuilder()
 *   .addPart(part)
 *   .addAssembly({
 *     id: 2,
 *     name: "root",
 *     placements: [{ kind: "part", partId: 1, transform: identityMatrix() }],
 *   })
 *   .setRootAssembly(2)
 *   .build();
 * const viewport = await createViewport({ canvas, scene });
 * // The host removes its own event listeners before destroying the viewport.
 * viewport.destroy();
 * ```
 * @category Start here
 */
export async function createViewport(options: ViewportOptions): Promise<Viewport> {
  assertViewportBackground(options.background);
  assertOriginTriad(options.originTriad);
  assertPixelSize("pointSizePixels", options.pointSizePixels);
  assertPixelSize("nodeSizePixels", options.nodeSizePixels);
  validateOrientationGizmo(options.canvas, options.orientationGizmo);
  const owner: { viewport?: ViewportCore } = {};
  let pendingLoss: DeviceLostInfo | undefined;
  const renderer = await createWebGpuRenderer({
    canvas: options.canvas,
    ...(options.device === undefined ? {} : { device: options.device }),
    ...(options.powerPreference === undefined ? {} : { powerPreference: options.powerPreference }),
    onDeviceLost: (info) => {
      options.onDeviceLost?.(info);
      if (owner.viewport === undefined) pendingLoss = info;
      else owner.viewport.handleDeviceLoss();
    },
    ...(options.background === undefined ? {} : { background: options.background }),
    ...(options.originTriad === undefined ? {} : { originTriad: options.originTriad }),
    ...(options.pointSizePixels === undefined ? {} : { pointSizePixels: options.pointSizePixels }),
    ...(options.nodeSizePixels === undefined ? {} : { nodeSizePixels: options.nodeSizePixels }),
  });
  owner.viewport = new ViewportCore(options, renderer);
  if (pendingLoss !== undefined) owner.viewport.handleDeviceLoss();
  return owner.viewport;
}

class ViewportCore implements Viewport {
  private cameraRef!: { camera: Camera };
  private currentSectionPlane: SectionPlane | undefined;
  private appliedInteraction = createInteractionState();
  private readonly cameraFocus!: CameraFocusController;
  private sceneController!: ViewportSceneController;
  private visibilityController!: ViewportVisibilityController;
  private readonly lifecycle!: ViewportLifecycleController;
  readonly view!: ViewportView;
  readonly interaction!: ViewportInteraction;
  readonly visibility!: ViewportVisibility;
  readonly results!: ViewportResults;
  readonly presentation!: ViewportPresentation;
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
    this.initializeControllers(options, renderer);
    const deformation = () => this.sceneController.results?.deformation;
    const navigationBounds = () =>
      this.navigationBoundsCache.get(
        this.sceneController.scene,
        this.sceneController.runtime,
        deformation(),
      );
    this.cameraFocus = this.createCameraFocus(options, deformation);
    const bindings = installViewportCanvasBindings({
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
    this.lifecycle = this.createLifecycle(options, bindings);
    const capabilities = this.createCapabilities();
    this.view = capabilities.view;
    this.interaction = capabilities.interaction;
    this.visibility = capabilities.visibility;
    this.results = capabilities.results;
    this.presentation = capabilities.presentation;
    this.resize(false);
    try {
      if (options.results !== undefined) this.sceneController.setResults(options.results);
      if (options.camera === undefined) {
        this.resizeCameraPolicy = "refit";
        this.cameraFocus.fitView(undefined, false);
      }
      this.render();
    } catch (error) {
      this.destroy();
      throw error;
    }
  }

  private initializeControllers(options: ViewportOptions, renderer: WebGpuRenderer): void {
    this.sceneController = new ViewportSceneController({
      scene: options.scene,
      interaction: options.interaction,
      renderer,
    });
    this.cameraRef = { camera: options.camera ?? createCamera() };
    this.visibilityController = new ViewportVisibilityController({
      viewport: this,
      sceneController: this.sceneController,
      renderer,
      isBatching: () => this.lifecycle.isBatching,
      invalidate: this.invalidate.bind(this),
      navigationBoundsCache: this.navigationBoundsCache,
    });
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

  private createCapabilities(): ReturnType<typeof createViewportCapabilities> {
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
      visibilityController: this.visibilityController,
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
    const interaction = this.sceneController.interaction;
    const interactionChanged = this.appliedInteraction !== interaction;
    const changed = interactionChanged
      ? changedInstanceSlots(runtime, this.appliedInteraction, interaction)
      : [];
    if (changed.length > 0) this.renderer.updateInstances(runtime, interaction, changed);
    if (interactionChanged) this.renderer.updateElements(runtime, interaction, changed);
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
