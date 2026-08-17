import { assertValidCamera, createCamera, resizeCamera, type Camera } from "../camera/camera";
import { installCameraControlsWithProtectedBounds } from "../camera/controls";
import { createInteractionState, type InteractionState } from "../interaction/interaction";
import type { BoxSelectionRect } from "../interaction/box-selection";
import type { InteractionTarget } from "../interaction/target-types";
import type { DeviceLostInfo } from "../platform/device";
import { createWebGpuRenderer, type WebGpuRenderer } from "../renderer/gpu-renderer";
import { changedInstanceSlots } from "./interaction-diff";
import type { SceneRuntime } from "../scene-runtime/public-runtime";
import type { Scene } from "../scene/scene";
import type { PartId } from "../geometry/part";
import type { InteractionGranularity, PickHit } from "../picking/types";
import type { AssemblyId, AssemblyOccurrenceId, InstanceId } from "../scene/types";
import { SceneNavigationBoundsCache, type SceneNavigationBounds } from "./scene-bounds";
import {
  assertViewportBackground,
  cssSize,
  installResize,
  installViewportKeyboard,
  validateOrientationGizmo,
} from "./dom";
import { CameraFocusController } from "./camera-focus";
import { normalizeSectionPlane, type SectionPlane } from "../math/section-plane";
import { assertOriginTriad } from "./origin-triad";
import type { DeformationState } from "../results/deform";
import { createOrientationGizmo, type OrientationGizmoHandle } from "./orientation-gizmo";
import type { ViewportResultsConfig, ViewportResultsState } from "./results";
import type {
  CameraTransitionOptions,
  Viewport,
  ViewportOptions,
  SceneUpdateOutcome,
  ViewportBackground,
} from "./types";
import { ViewportSceneController } from "./scene-controller";
import { ViewportVisibilityController } from "./visibility-controller";
import { ViewportLifecycleController } from "./lifecycle-controller";
export type { Viewport, ViewportOptions, SceneUpdateOutcome, ViewportBackground } from "./types";

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
 * import { createViewport, createPart, createScene, identity } from "femgx";
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
 * const scene = createScene()
 *   .addPart(part)
 *   .addAssembly({
 *     id: 2,
 *     name: "root",
 *     placements: [{ kind: "part", partId: 1, transform: identity() }],
 *   })
 *   .withRoot(2)
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
  private cameraRef: { camera: Camera };
  private currentSectionPlane: SectionPlane | undefined;
  private appliedInteraction = createInteractionState();
  private readonly cameraFocus: CameraFocusController;
  private readonly sceneController: ViewportSceneController;
  private readonly visibility: ViewportVisibilityController;
  private readonly lifecycle: ViewportLifecycleController;
  private autoFitOnResize = false;
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
    this.sceneController = new ViewportSceneController({
      scene: options.scene,
      interaction: options.interaction,
      renderer,
    });
    this.cameraRef = { camera: options.camera ?? createCamera() };
    this.visibility = new ViewportVisibilityController({
      runtime: () => this.sceneController.runtime,
      renderer,
      isBatching: () => this.lifecycle.isBatching,
      invalidate: this.invalidate.bind(this),
      navigationBoundsCache: this.navigationBoundsCache,
    });
    const deformation = () => this.sceneController.results?.deformation;
    const navigationBounds = () =>
      this.navigationBoundsCache.get(
        this.sceneController.scene,
        this.sceneController.runtime,
        deformation(),
      );
    this.cameraFocus = this.createCameraFocus(options, deformation);
    assertValidCamera(this.cameraRef.camera);
    const bindings = this.installCanvasBindings(options, navigationBounds);
    this.lifecycle = new ViewportLifecycleController({
      renderer,
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
    this.resize(false);
    try {
      if (options.results !== undefined) this.sceneController.setResults(options.results);
      if (options.camera === undefined) {
        this.autoFitOnResize = true;
        this.cameraFocus.fitView(undefined, false);
      }
      this.render();
    } catch (error) {
      this.destroy();
      throw error;
    }
  }

  private installCanvasBindings(
    options: ViewportOptions,
    navigationBounds: () => SceneNavigationBounds,
  ): {
    readonly removeControls: () => void;
    readonly removeResize: () => void;
    readonly removeKeyboard: () => void;
    readonly orientationGizmo: OrientationGizmoHandle | undefined;
  } {
    const removeKeyboard = installViewportKeyboard(options.keyboardTarget, () => {
      this.fitSelection();
    });
    const removeControls = installCameraControlsWithProtectedBounds({
      canvas: options.canvas,
      cameraRef: this.cameraRef,
      navigation: this.renderer,
      bounds: () => navigationBounds().bounds,
      protectedBounds: () => navigationBounds().protectedBounds,
      onRender: this.invalidate.bind(this),
      onGestureChange: (active) => {
        if (active) {
          this.autoFitOnResize = false;
          this.cameraFocus.cancel();
        }
        options.onGestureChange?.(active);
      },
    });
    const removeResize = installResize(options.canvas, () => {
      this.resize();
    });
    const orientationGizmo =
      options.orientationGizmo === undefined
        ? undefined
        : createOrientationGizmo(options.orientationGizmo, (action) => {
            this.cameraFocus.applyOrientationAction(action);
          });
    return { removeControls, removeResize, removeKeyboard, orientationGizmo };
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
  get runtime(): SceneRuntime {
    return this.sceneController.publicRuntime;
  }
  get camera(): Camera {
    return this.cameraRef.camera;
  }
  get interaction(): InteractionState {
    return this.sceneController.interaction;
  }
  get results(): ViewportResultsState | undefined {
    return this.sceneController.results;
  }
  get sectionPlane(): SectionPlane | undefined {
    return this.currentSectionPlane;
  }

  setScene(scene: Scene): void {
    this.ensureAlive();
    this.sceneController.setScene(scene, this.cameraFocus.cancel.bind(this.cameraFocus));
    this.visibility.reset();
    this.appliedInteraction = createInteractionState();
    this.invalidate();
  }

  updateScene(scene: Scene): SceneUpdateOutcome {
    this.ensureAlive();
    const outcome = this.sceneController.updateScene(
      scene,
      this.cameraFocus.cancel.bind(this.cameraFocus),
    );
    this.visibility.reset();
    this.appliedInteraction = createInteractionState();
    this.invalidate();
    return outcome;
  }

  setCamera(camera: Camera, transitionOptions?: CameraTransitionOptions): void {
    this.ensureAlive();
    this.autoFitOnResize = false;
    this.cameraFocus.setCamera(camera, transitionOptions);
  }

  fitView(transitionOptions?: CameraTransitionOptions): void {
    this.ensureAlive();
    this.autoFitOnResize = true;
    this.cameraFocus.fitView(transitionOptions, true);
  }

  fitSelection(transitionOptions?: CameraTransitionOptions): void {
    this.ensureAlive();
    this.autoFitOnResize = false;
    this.cameraFocus.fitSelection(transitionOptions);
  }

  setInteraction(interaction: InteractionState): void {
    this.ensureAlive();
    this.sceneController.setInteraction(interaction);
    this.invalidate();
  }

  batch<T>(operation: () => T): T {
    this.ensureAlive();
    return this.lifecycle.batch(operation, this.visibility.flush.bind(this.visibility));
  }

  setResults(results: ViewportResultsConfig): void {
    this.ensureAlive();
    this.sceneController.setResults(results);
    this.invalidate();
  }

  clearResults(): void {
    this.ensureAlive();
    this.sceneController.clearResults();
    this.invalidate();
  }

  setSectionPlane(plane: SectionPlane): void {
    this.ensureAlive();
    const normalized = normalizeSectionPlane(plane);
    this.currentSectionPlane = normalized;
    this.renderer.setSectionPlane(normalized);
    this.invalidate();
  }

  clearSectionPlane(): void {
    this.ensureAlive();
    if (this.currentSectionPlane === undefined) return;
    this.currentSectionPlane = undefined;
    this.renderer.setSectionPlane(undefined);
    this.invalidate();
  }

  setBackground(background: ViewportBackground): void {
    this.ensureAlive();
    assertViewportBackground(background);
    if (this.background === background) return;
    this.background = background;
    this.renderer.setBackground(background);
    this.invalidate();
  }

  setPointSizePixels(size: number): void {
    this.ensureAlive();
    assertPixelSize("pointSizePixels", size);
    if (this.pointSizePixels === size) return;
    this.renderer.setPointSizePixels(size);
    this.pointSizePixels = size;
    this.invalidate();
  }

  setNodeSizePixels(size: number): void {
    this.ensureAlive();
    assertPixelSize("nodeSizePixels", size);
    if (this.nodeSizePixels === size) return;
    this.renderer.setNodeSizePixels(size);
    this.nodeSizePixels = size;
    this.invalidate();
  }

  setEdgeDepthTest(enabled: boolean): void {
    this.ensureAlive();
    this.renderer.setEdgeDepthTest(enabled);
    this.invalidate();
  }

  setPartVisible(partId: PartId, visible: boolean): void {
    this.ensureAlive();
    this.visibility.setPartVisible(partId, visible);
  }
  setAssemblyOccurrenceVisible(occurrenceId: AssemblyOccurrenceId, visible: boolean): void {
    this.ensureAlive();
    this.visibility.setAssemblyOccurrenceVisible(occurrenceId, visible);
  }
  setAssemblyVisible(assemblyId: AssemblyId, visible: boolean): void {
    this.ensureAlive();
    this.visibility.setAssemblyVisible(assemblyId, visible);
  }
  setInstanceVisible(instanceId: InstanceId, visible: boolean): void {
    this.ensureAlive();
    this.visibility.setInstanceVisible(instanceId, visible);
  }

  pick(x: number, y: number, granularity?: "edge"): Promise<PickHit | undefined> {
    this.ensureAlive();
    return this.renderer.pick(x, y, granularity);
  }
  pickRegion(
    rect: BoxSelectionRect,
    granularity: InteractionGranularity,
  ): Promise<readonly InteractionTarget[]> {
    this.ensureAlive();
    return this.renderer.pickRegion(rect, granularity);
  }
  resize(invalidate = true): void {
    this.ensureAlive();
    const refit = this.autoFitOnResize;
    this.cameraFocus.cancel();
    const size = cssSize(this.options.canvas);
    this.renderer.resize(size.width, size.height);
    this.cameraRef.camera = resizeCamera(this.cameraRef.camera, size.width, size.height);
    if (refit) this.cameraFocus.fitView(undefined, false);
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
    const interaction = this.sceneController.effectiveInteractionState;
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
    this.ensureAlive();
    return this.lifecycle.recover();
  }
  handleDeviceLoss(): void {
    this.lifecycle.handleDeviceLoss();
  }

  destroy(): void {
    this.lifecycle.destroy();
  }

  stats(): { readonly visibleInstances: number; readonly drawBatches: number } {
    return {
      visibleInstances: this.sceneController.runtime.visibleCount,
      drawBatches: this.renderer.stats().drawBatches,
    };
  }

  private ensureAlive(): void {
    this.lifecycle.ensureAlive();
  }
}

function assertPixelSize(name: string, value: number | undefined): void {
  if (value === undefined) return;
  if (!Number.isFinite(value) || value < 1 || value > 64) {
    throw new RangeError(`${name} must be finite and in [1, 64] CSS pixels`);
  }
}
