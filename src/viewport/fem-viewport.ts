import { assertValidCamera, createCamera, resizeCamera, type Camera } from "../camera/camera";
import { installCameraControlsWithProtectedBounds } from "../camera/controls";
import { fitCamera } from "../camera/fit";
import { applyViewCubeAction, type ViewCubeAction } from "../camera/view-cube";
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
import { protectSceneCamera, sceneWorldBounds, sceneWorldBoundsList } from "./scene-bounds";
import { cssSize, installResize, validateOrientationGizmo } from "./dom";
import { createOrientationGizmo, type OrientationGizmoHandle } from "./orientation-gizmo";
import {
  applyViewportResultInteraction,
  resolveViewportResults,
  type ViewportResultsConfig,
  type ViewportResultsState,
} from "./results";
import type { FemViewport, FemViewportOptions, ViewportBackground } from "./types";
export type { FemViewport, FemViewportOptions, ViewportBackground } from "./types";

/** Creates a fitted, interactive FEM viewport backed only by WebGPU. */
export async function createFemViewport(options: FemViewportOptions): Promise<FemViewport> {
  assertViewportBackground(options.background);
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
  private orientationGizmo: OrientationGizmoHandle | undefined;
  private frame: number | undefined;
  private recoveryPromise: Promise<void> | undefined;
  private batchDepth = 0;
  private batchDirty = false;
  private readonly pendingVisibility = new Set<number>();
  private destroyed = false;
  private background: ViewportBackground;

  constructor(
    private readonly options: FemViewportOptions,
    private readonly renderer: WebGpuRenderer,
  ) {
    this.currentScene = options.scene;
    this.background = options.background ?? "studio";
    this.currentRuntime = createPackedSceneRuntime(options.scene);
    this.currentPublicRuntime = createPublicSceneRuntime(this.currentRuntime);
    this.effectiveInteraction = this.baseInteraction =
      options.interaction ?? createInteractionState();
    this.cameraRef = { camera: options.camera ?? createCamera() };
    assertValidCamera(this.cameraRef.camera);
    this.resize(false);
    if (options.camera === undefined) this.fitView(false);
    this.removeControls = installCameraControlsWithProtectedBounds({
      canvas: options.canvas,
      cameraRef: this.cameraRef,
      navigation: renderer,
      bounds: () => sceneWorldBounds(this.currentScene, this.currentRuntime),
      protectedBounds: () => sceneWorldBoundsList(this.currentScene, this.currentRuntime),
      onRender: this.invalidate.bind(this),
      ...(options.onGestureChange === undefined
        ? {}
        : { onGestureChange: options.onGestureChange }),
    });
    this.removeResize = installResize(options.canvas, () => {
      this.resize();
    });
    this.orientationGizmo =
      options.orientationGizmo === undefined
        ? undefined
        : createOrientationGizmo(options.orientationGizmo, (action) => {
            this.applyOrientationAction(action);
          });
    try {
      if (options.results !== undefined) this.applyResults(options.results);
      this.render();
    } catch (error) {
      this.destroy();
      throw error;
    }
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
    this.currentScene = scene;
    this.currentRuntime = createPackedSceneRuntime(scene);
    this.currentPublicRuntime = createPublicSceneRuntime(this.currentRuntime);
    this.pendingVisibility.clear();
    this.currentResults = undefined;
    this.effectiveInteraction = this.baseInteraction;
    this.appliedInteraction = createInteractionState();
    this.renderer.setDeformation(undefined);
    this.fitView(false);
    this.invalidate();
  }

  setCamera(camera: Camera): void {
    this.ensureAlive();
    assertValidCamera(camera);
    this.cameraRef.camera = protectSceneCamera(camera, this.currentScene, this.currentRuntime);
    this.invalidate();
  }

  fitView(invalidate = true): void {
    this.ensureAlive();
    const size = cssSize(this.options.canvas);
    this.cameraRef.camera = fitCamera(
      this.cameraRef.camera,
      sceneWorldBounds(this.currentScene, this.currentRuntime),
      size.width,
      size.height,
    );
    if (invalidate) this.invalidate();
  }

  setInteraction(interaction: InteractionState): void {
    this.ensureAlive();
    this.baseInteraction = interaction;
    this.effectiveInteraction = this.resolveEffectiveInteraction();
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
    this.applyVisibility(this.currentRuntime.setPartVisible(partId, visible).changedInstanceIds);
  }
  setAssemblyNodeVisible(nodeId: AssemblyNodeId, visible: boolean): void {
    const node = this.currentRuntime.getNodeSlot(nodeId);
    this.applyVisibility(
      node === undefined
        ? []
        : this.currentRuntime.setAssemblyNodeVisible(node, visible).changedInstanceIds,
    );
  }
  setAssemblyVisible(assemblyId: AssemblyId, visible: boolean): void {
    this.applyVisibility(
      this.currentRuntime.setAssemblyVisible(assemblyId, visible).changedInstanceIds,
    );
  }
  setInstanceVisible(instanceId: InstanceId, visible: boolean): void {
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
    const size = cssSize(this.options.canvas);
    this.renderer.resize(size.width, size.height);
    this.cameraRef.camera = resizeCamera(this.cameraRef.camera, size.width, size.height);
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
    this.renderer.render(this.currentRuntime, this.cameraRef.camera, this.currentScene.parts);
    this.appliedInteraction = this.effectiveInteraction;
    this.options.onRender?.();
  }

  recover(): Promise<void> {
    this.ensureAlive();
    if (this.recoveryPromise !== undefined) return this.recoveryPromise;
    const recovery = this.recoverOnce();
    this.recoveryPromise = recovery;
    recovery.then(
      () => {
        if (this.recoveryPromise === recovery) this.recoveryPromise = undefined;
      },
      () => {
        if (this.recoveryPromise === recovery) this.recoveryPromise = undefined;
      },
    );
    return recovery;
  }

  private async recoverOnce(): Promise<void> {
    await this.renderer.recover();
    this.appliedInteraction = createInteractionState();
    this.render();
    this.options.onRecovered?.();
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
    this.removeControls();
    this.removeResize();
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
    this.ensureAlive();
    if (changed.length === 0) return;
    if (this.batchDepth > 0) for (const slot of changed) this.pendingVisibility.add(slot);
    else this.renderer.updateVisibility(this.currentRuntime, changed);
    this.invalidate();
  }

  private flushBatch(): void {
    if (this.pendingVisibility.size > 0) {
      const changed = [...this.pendingVisibility].sort((a, b) => a - b);
      this.pendingVisibility.clear();
      this.renderer.updateVisibility(this.currentRuntime, changed);
    }
    if (this.batchDirty) {
      this.batchDirty = false;
      this.invalidate();
    }
  }

  private applyResults(results: ViewportResultsConfig): void {
    const resolved = resolveViewportResults(results, this.currentScene, this.currentRuntime);
    this.currentResults = resolved;
    this.effectiveInteraction = this.resolveEffectiveInteraction();
    this.renderer.setDeformation(resolved.deformation);
  }

  private applyOrientationAction(action: ViewCubeAction): void {
    this.cameraRef.camera = applyViewCubeAction(
      this.cameraRef.camera,
      sceneWorldBounds(this.currentScene, this.currentRuntime),
      action,
    );
    this.invalidate();
  }

  private resolveEffectiveInteraction(): InteractionState {
    const results = this.currentResults;
    return results === undefined
      ? this.baseInteraction
      : applyViewportResultInteraction(
          this.baseInteraction,
          results.scalarField,
          results.colorMap,
          this.currentScene,
          this.currentRuntime,
        );
  }

  private ensureAlive(): void {
    if (this.destroyed) throw new Error("FemViewport has been destroyed");
  }
}

function assertViewportBackground(value: unknown): asserts value is ViewportBackground | undefined {
  if (value === undefined || value === "studio" || value === "white" || value === "dark") return;
  throw new Error("Invalid viewport background; expected studio, white, or dark");
}
