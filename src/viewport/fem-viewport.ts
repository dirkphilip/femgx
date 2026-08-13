/* eslint-disable max-lines -- the canonical viewport facade keeps lifecycle ownership together. */
import { assertValidCamera, createCamera, resizeCamera, type Camera } from "../camera/camera";
import { installCameraControlsWithProtectedBounds } from "../camera/controls";
import { createInteractionState, type InteractionState } from "../interaction/interaction";
import type { BoxSelectionRect } from "../interaction/box-selection";
import type { InteractionTarget } from "../interaction/target-types";
import type { DeviceLostInfo } from "../platform/device";
import { createWebGpuRenderer, type WebGpuRenderer } from "../renderer/gpu-renderer";
import { changedInstanceSlots } from "./interaction-diff";
import { createPackedSceneRuntime, type PackedSceneRuntime } from "../scene-runtime/runtime";
import { createPublicSceneRuntime, type SceneRuntime } from "../scene-runtime/public-runtime";
import type { Scene } from "../scene/scene";
import type { PartId } from "../geometry/part";
import type { InteractionGranularity, PickHit } from "../picking/types";
import type { AssemblyId, AssemblyNodeId, InstanceId } from "../scene/types";
import { sceneWorldBounds, sceneWorldBoundsList } from "./scene-bounds";
import {
  assertViewportBackground,
  cssSize,
  installResize,
  installViewportKeyboard,
  validateOrientationGizmo,
} from "./dom";
import { CameraFocusController } from "./camera-focus";
import { flushViewportBatch } from "./batch";
import { assertOriginTriad, sceneOriginTriadScale } from "./origin-triad";
import type { DeformationState } from "../results/deform";
import { createOrientationGizmo, type OrientationGizmoHandle } from "./orientation-gizmo";
import {
  resolveViewportInteraction,
  type ViewportResultsConfig,
  type ViewportResultsState,
} from "./results";
import { applyViewportResults } from "./results-application";
import type {
  CameraTransitionOptions,
  FemViewport,
  FemViewportOptions,
  ViewportBackground,
} from "./types";
export type { FemViewport, FemViewportOptions, ViewportBackground } from "./types";

/** Creates a fitted, interactive FEM viewport backed only by WebGPU. */
export async function createFemViewport(options: FemViewportOptions): Promise<FemViewport> {
  assertViewportBackground(options.background);
  assertOriginTriad(options.originTriad);
  validateOrientationGizmo(options.canvas, options.orientationGizmo);
  const owner: { viewport?: FemViewportCore } = {};
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
  });
  owner.viewport = new FemViewportCore(options, renderer);
  if (pendingLoss !== undefined) owner.viewport.handleDeviceLoss();
  return owner.viewport;
}

class FemViewportCore implements FemViewport {
  private currentScene: Scene;
  private currentRuntime: PackedSceneRuntime;
  private currentPublicRuntime: SceneRuntime;
  private cameraRef: { camera: Camera };
  private baseInteraction: InteractionState;
  private effectiveInteraction: InteractionState;
  private currentResults: ViewportResultsState | undefined;
  private appliedInteraction = createInteractionState();
  private readonly removeControls: () => void;
  private readonly removeResize: () => void;
  private readonly removeKeyboard: () => void;
  private readonly cameraFocus: CameraFocusController;
  private orientationGizmo: OrientationGizmoHandle | undefined;
  private frame: number | undefined;
  private recoveryPromise: Promise<void> | undefined;
  private batchDepth = 0;
  private batchDirty = false;
  private readonly pendingVisibility = new Set<number>();
  private destroyed = false;
  private autoFitOnResize = false;
  private background: ViewportBackground;
  private originTriadNominalScale: number;

  constructor(
    private readonly options: FemViewportOptions,
    private readonly renderer: WebGpuRenderer,
  ) {
    this.currentScene = options.scene;
    this.background = options.background ?? "studio";
    this.currentRuntime = createPackedSceneRuntime(options.scene);
    this.originTriadNominalScale = sceneOriginTriadScale(options.scene, this.currentRuntime);
    this.currentPublicRuntime = createPublicSceneRuntime(this.currentRuntime);
    this.effectiveInteraction = this.baseInteraction =
      options.interaction ?? createInteractionState();
    this.cameraRef = { camera: options.camera ?? createCamera() };
    const deformation = () => this.currentResults?.deformation;
    this.cameraFocus = this.createCameraFocus(options, deformation);
    this.removeKeyboard = installViewportKeyboard(options.keyboardTarget, () => {
      this.fitSelection();
    });
    assertValidCamera(this.cameraRef.camera);
    this.resize(false);
    if (options.camera === undefined) {
      this.autoFitOnResize = true;
      this.cameraFocus.fitView(undefined, false);
    }
    this.removeControls = installCameraControlsWithProtectedBounds({
      canvas: options.canvas,
      cameraRef: this.cameraRef,
      navigation: renderer,
      bounds: () => sceneWorldBounds(this.currentScene, this.currentRuntime, deformation()),
      protectedBounds: () =>
        sceneWorldBoundsList(this.currentScene, this.currentRuntime, deformation()),
      onRender: this.invalidate.bind(this),
      onGestureChange: (active) => {
        if (active) {
          this.autoFitOnResize = false;
          this.cameraFocus.cancel();
        }
        options.onGestureChange?.(active);
      },
    });
    this.removeResize = installResize(options.canvas, () => {
      this.resize();
    });
    this.orientationGizmo =
      options.orientationGizmo === undefined
        ? undefined
        : createOrientationGizmo(options.orientationGizmo, (action) => {
            this.cameraFocus.applyOrientationAction(action);
          });
    try {
      if (options.results !== undefined) this.applyResults(options.results);
      this.render();
    } catch (error) {
      this.destroy();
      throw error;
    }
  }

  private createCameraFocus(
    options: FemViewportOptions,
    deformation: () => DeformationState | undefined,
  ): CameraFocusController {
    return new CameraFocusController({
      cameraRef: this.cameraRef,
      canvas: options.canvas,
      scene: () => this.currentScene,
      runtime: () => this.currentRuntime,
      interaction: () => this.baseInteraction,
      deformation,
      ...(options.fitContentInset === undefined
        ? {}
        : { fitContentInset: options.fitContentInset }),
      invalidate: this.invalidate.bind(this),
    });
  }

  get scene(): Scene {
    return this.currentScene;
  }
  get runtime(): SceneRuntime {
    return this.currentPublicRuntime;
  }
  get camera(): Camera {
    return this.cameraRef.camera;
  }
  get interaction(): InteractionState {
    return this.baseInteraction;
  }
  get results(): ViewportResultsState | undefined {
    return this.currentResults;
  }

  setScene(scene: Scene): void {
    this.ensureAlive();
    const nextRuntime = createPackedSceneRuntime(scene);
    const nextOriginTriadNominalScale = sceneOriginTriadScale(scene, nextRuntime);
    const nextPublicRuntime = createPublicSceneRuntime(nextRuntime);
    this.cameraFocus.cancel();
    this.currentScene = scene;
    this.currentRuntime = nextRuntime;
    this.originTriadNominalScale = nextOriginTriadNominalScale;
    this.currentPublicRuntime = nextPublicRuntime;
    this.pendingVisibility.clear();
    this.currentResults = undefined;
    this.effectiveInteraction = this.baseInteraction;
    this.appliedInteraction = createInteractionState();
    this.autoFitOnResize = true;
    this.renderer.setDeformation(undefined);
    this.renderer.setResultColors(undefined);
    this.cameraFocus.fitView(undefined, false);
    this.invalidate();
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
    this.baseInteraction = interaction;
    this.effectiveInteraction = resolveViewportInteraction(
      interaction,
      this.currentResults,
      this.currentScene,
      this.currentRuntime,
    );
    this.invalidate();
  }

  batch<T>(operation: () => T): T {
    this.ensureAlive();
    this.batchDepth += 1;
    try {
      return operation();
    } finally {
      this.batchDepth -= 1;
      if (this.batchDepth === 0) this.flushBatch();
    }
  }

  setResults(results: ViewportResultsConfig): void {
    this.ensureAlive();
    this.applyResults(results);
    this.invalidate();
  }

  clearResults(): void {
    this.ensureAlive();
    this.currentResults = undefined;
    this.effectiveInteraction = this.baseInteraction;
    this.renderer.setDeformation(undefined);
    this.renderer.setResultColors(undefined);
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

  setEdgeDepthTest(enabled: boolean): void {
    this.ensureAlive();
    this.renderer.setEdgeDepthTest(enabled);
    this.invalidate();
  }

  setPartVisible(partId: PartId, visible: boolean): void {
    this.ensureAlive();
    this.applyVisibility(this.currentRuntime.setPartVisible(partId, visible).changedInstanceIds);
  }
  setAssemblyNodeVisible(nodeId: AssemblyNodeId, visible: boolean): void {
    this.ensureAlive();
    const node = this.currentRuntime.getNodeSlot(nodeId);
    this.applyVisibility(
      node === undefined
        ? []
        : this.currentRuntime.setAssemblyNodeVisible(node, visible).changedInstanceIds,
    );
  }
  setAssemblyVisible(assemblyId: AssemblyId, visible: boolean): void {
    this.ensureAlive();
    this.applyVisibility(
      this.currentRuntime.setAssemblyVisible(assemblyId, visible).changedInstanceIds,
    );
  }
  setInstanceVisible(instanceId: InstanceId, visible: boolean): void {
    this.ensureAlive();
    const slot = this.currentRuntime.getInstanceSlot(instanceId);
    this.applyVisibility(
      slot === undefined
        ? []
        : this.currentRuntime.setInstanceVisible(slot, visible).changedInstanceIds,
    );
  }

  pick(x: number, y: number): Promise<PickHit | undefined> {
    this.ensureAlive();
    return this.renderer.pick(x, y);
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
    if (this.batchDepth > 0) {
      this.batchDirty = true;
      return;
    }
    if (this.frame !== undefined) return;
    if (typeof requestAnimationFrame === "undefined") {
      this.render();
      return;
    }
    this.frame = requestAnimationFrame(() => {
      this.frame = undefined;
      this.render();
    });
  }

  render(): void {
    this.ensureAlive();
    if (this.batchDepth > 0) {
      this.batchDirty = true;
      return;
    }
    const changed = changedInstanceSlots(
      this.currentRuntime,
      this.appliedInteraction,
      this.effectiveInteraction,
    );
    this.renderer.updateInstances(this.currentRuntime, this.effectiveInteraction, changed);
    this.renderer.updateElements(this.currentRuntime, this.effectiveInteraction);
    this.orientationGizmo?.update(this.cameraRef.camera);
    this.renderer.render(
      this.currentRuntime,
      this.cameraRef.camera,
      this.currentScene.parts,
      this.originTriadNominalScale,
    );
    this.appliedInteraction = this.effectiveInteraction;
    this.options.onRender?.();
  }

  recover(): Promise<void> {
    this.ensureAlive();
    if (this.recoveryPromise !== undefined) return this.recoveryPromise;
    const recovery = this.renderer.recover().then(() => {
      this.appliedInteraction = createInteractionState();
      this.render();
      this.options.onRecovered?.();
    });
    this.recoveryPromise = recovery;
    const clearRecovery = (): void => {
      if (this.recoveryPromise === recovery) this.recoveryPromise = undefined;
    };
    recovery.then(clearRecovery, clearRecovery);
    return recovery;
  }
  handleDeviceLoss(): void {
    if (this.destroyed) return;
    void this.recover().catch((error: unknown) => {
      if (this.destroyed) return;
      this.destroy();
      this.options.onError?.(error);
    });
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.frame !== undefined && typeof cancelAnimationFrame !== "undefined") {
      cancelAnimationFrame(this.frame);
    }
    this.cameraFocus.dispose();
    this.removeControls();
    this.removeResize();
    this.removeKeyboard();
    this.orientationGizmo?.destroy();
    this.renderer.destroy();
  }

  stats(): { readonly visibleInstances: number; readonly drawBatches: number } {
    return {
      visibleInstances: this.currentRuntime.visibleCount,
      drawBatches: this.renderer.stats().drawBatches,
    };
  }

  private applyVisibility(changed: readonly number[]): void {
    if (changed.length === 0) return;
    if (this.batchDepth > 0) for (const slot of changed) this.pendingVisibility.add(slot);
    else this.renderer.updateVisibility(this.currentRuntime, changed);
    this.invalidate();
  }

  private flushBatch(): void {
    flushViewportBatch({
      pendingVisibility: this.pendingVisibility,
      batchDirty: this.batchDirty,
      runtime: this.currentRuntime,
      renderer: this.renderer,
      invalidate: this.invalidate.bind(this),
    });
    this.batchDirty = false;
  }

  private applyResults(results: ViewportResultsConfig): void {
    const applied = applyViewportResults(
      results,
      this.currentScene,
      this.currentRuntime,
      this.baseInteraction,
      this.renderer,
    );
    this.currentResults = applied.results;
    this.effectiveInteraction = applied.interaction;
  }

  private ensureAlive(): void {
    if (this.destroyed) throw new Error("FemViewport has been destroyed");
  }
}
