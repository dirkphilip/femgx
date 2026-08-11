import {
  assertValidCamera,
  createCamera,
  resizeCamera,
  type Camera,
  type Vec3,
} from "../camera/camera";
import { installCameraControls } from "../camera/controls";
import { fitCamera } from "../camera/fit";
import { createInteractionState, type InteractionState } from "../interaction/interaction";
import type { DeviceLostInfo } from "../platform/device";
import type { PickGranularity } from "../picking/pick";
import { defaultDeformation } from "../renderer/gpu-deform";
import { createWebGpuRenderer, type WebGpuRenderer } from "../renderer/gpu-renderer";
import { changedInstanceSlots } from "../renderer/interaction-diff";
import { createPackedSceneRuntime, type PackedSceneRuntime } from "../scene-runtime/runtime";
import { createPublicSceneRuntime, type SceneRuntime } from "../scene-runtime/public-runtime";
import type { Scene } from "../scene/scene";
import type { AssemblyId, AssemblyNodeId, InstanceId, PartId, PickTarget } from "../scene/types";
import { sceneWorldBounds } from "./scene-bounds";
import {
  applyViewportResultInteraction,
  resolveViewportResults,
  type ViewportResultsConfig,
  type ViewportResultsState,
} from "./results";

/** Inputs for the opinionated WebGPU FEM viewport. */
export interface FemViewportOptions {
  readonly canvas: HTMLCanvasElement;
  readonly scene: Scene;
  readonly camera?: Camera;
  readonly interaction?: InteractionState;
  readonly results?: ViewportResultsConfig;
  readonly device?: GPUDevice;
  readonly powerPreference?: GPUPowerPreference;
  readonly onDeviceLost?: (info: DeviceLostInfo) => void;
  readonly onRecovered?: () => void;
  readonly onError?: (error: unknown) => void;
  readonly onGestureChange?: (active: boolean) => void;
  readonly onRender?: () => void;
}

/** Canonical scene, camera, interaction, rendering, and lifecycle owner. */
export interface FemViewport {
  readonly scene: Scene;
  readonly runtime: SceneRuntime;
  readonly camera: Camera;
  readonly interaction: InteractionState;
  readonly results: ViewportResultsState | undefined;
  setScene(scene: Scene): void;
  setCamera(camera: Camera): void;
  fitView(): void;
  setInteraction(interaction: InteractionState): void;
  /** Groups synchronous mutations into one deferred invalidation and render. */
  batch<T>(operation: () => T): T;
  setResults(results: ViewportResultsConfig): void;
  clearResults(): void;
  setEdgeDepthTest(enabled: boolean): void;
  setNodeOverlay(enabled: boolean): void;
  setPartVisible(partId: PartId, visible: boolean): void;
  setAssemblyNodeVisible(nodeId: AssemblyNodeId, visible: boolean): void;
  setAssemblyVisible(assemblyId: AssemblyId, visible: boolean): void;
  setInstanceVisible(instanceId: InstanceId, visible: boolean): void;
  pick(x: number, y: number, granularity?: PickGranularity): Promise<PickTarget | undefined>;
  pickPoint(x: number, y: number): Promise<Vec3 | undefined>;
  resize(): void;
  invalidate(): void;
  render(): void;
  recover(): Promise<void>;
  destroy(): void;
  stats(): { readonly visibleInstances: number; readonly drawBatches: number };
}

/** Creates a fitted, interactive FEM viewport backed only by WebGPU. */
export async function createFemViewport(options: FemViewportOptions): Promise<FemViewport> {
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
  private currentInteraction: InteractionState;
  private currentResults: ViewportResultsState | undefined;
  private appliedInteraction = createInteractionState();
  private readonly removeControls: () => void;
  private readonly removeResize: () => void;
  private frame: number | undefined;
  private batchDepth = 0;
  private batchDirty = false;
  private readonly pendingVisibility = new Set<number>();
  private destroyed = false;

  constructor(
    private readonly options: FemViewportOptions,
    private readonly renderer: WebGpuRenderer,
  ) {
    this.currentScene = options.scene;
    this.currentRuntime = createPackedSceneRuntime(options.scene);
    this.currentPublicRuntime = createPublicSceneRuntime(this.currentRuntime);
    this.baseInteraction = options.interaction ?? createInteractionState();
    this.currentInteraction = this.baseInteraction;
    this.cameraRef = { camera: options.camera ?? createCamera() };
    assertValidCamera(this.cameraRef.camera);
    this.resize(false);
    if (options.camera === undefined) this.fitView(false);
    this.removeControls = installCameraControls({
      canvas: options.canvas,
      cameraRef: this.cameraRef,
      navigation: renderer,
      onRender: () => {
        this.invalidate();
      },
      ...(options.onGestureChange === undefined
        ? {}
        : { onGestureChange: options.onGestureChange }),
    });
    this.removeResize = installResize(options.canvas, () => {
      this.resize();
    });
    if (options.results !== undefined) this.applyResults(options.results);
    this.render();
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
    return this.currentInteraction;
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
    this.currentInteraction = this.baseInteraction;
    this.appliedInteraction = createInteractionState();
    this.renderer.setDeformation(defaultDeformation);
    this.fitView(false);
    this.invalidate();
  }

  setCamera(camera: Camera): void {
    this.ensureAlive();
    assertValidCamera(camera);
    this.cameraRef.camera = camera;
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
    this.currentInteraction =
      this.currentResults === undefined
        ? interaction
        : applyViewportResultInteraction(
            interaction,
            this.currentResults.scalarField,
            this.currentResults.colorMap,
            this.currentScene,
            this.currentRuntime,
          );
    if (this.currentResults !== undefined) {
      this.currentResults = { ...this.currentResults, interaction: this.currentInteraction };
    }
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
    this.currentInteraction = this.baseInteraction;
    this.renderer.setDeformation(defaultDeformation);
    this.invalidate();
  }

  setEdgeDepthTest(enabled: boolean): void {
    this.ensureAlive();
    this.renderer.setEdgeDepthTest(enabled);
    this.invalidate();
  }

  setNodeOverlay(enabled: boolean): void {
    this.ensureAlive();
    this.renderer.setNodeOverlay(enabled);
    this.invalidate();
  }

  setPartVisible(partId: PartId, visible: boolean): void {
    this.applyVisibility(
      this.currentPublicRuntime.setPartVisible(partId, visible).changedInstanceIds,
    );
  }
  setAssemblyNodeVisible(nodeId: AssemblyNodeId, visible: boolean): void {
    this.applyVisibility(
      this.currentPublicRuntime.setAssemblyNodeVisible(nodeId, visible).changedInstanceIds,
    );
  }
  setAssemblyVisible(assemblyId: AssemblyId, visible: boolean): void {
    this.applyVisibility(
      this.currentPublicRuntime.setAssemblyVisible(assemblyId, visible).changedInstanceIds,
    );
  }
  setInstanceVisible(instanceId: InstanceId, visible: boolean): void {
    this.applyVisibility(
      this.currentPublicRuntime.setInstanceVisible(instanceId, visible).changedInstanceIds,
    );
  }

  pick(x: number, y: number, granularity?: PickGranularity): Promise<PickTarget | undefined> {
    this.ensureAlive();
    return this.renderer.pick(x, y, granularity);
  }
  pickPoint(x: number, y: number): Promise<Vec3 | undefined> {
    this.ensureAlive();
    return this.renderer.pickPoint(this.cameraRef.camera, x, y);
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
      this.currentInteraction,
    );
    this.renderer.updateInstances(this.currentRuntime, this.currentInteraction, changed);
    this.renderer.updateElements(this.currentRuntime, this.currentInteraction);
    this.renderer.render(this.currentRuntime, this.cameraRef.camera, this.currentScene.parts);
    this.appliedInteraction = this.currentInteraction;
    this.options.onRender?.();
  }

  async recover(): Promise<void> {
    this.ensureAlive();
    await this.renderer.recover();
    this.appliedInteraction = createInteractionState();
    this.render();
    this.options.onRecovered?.();
  }

  handleDeviceLoss(): void {
    void this.recover().catch((error: unknown) => {
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
    this.renderer.destroy();
  }

  stats(): { readonly visibleInstances: number; readonly drawBatches: number } {
    return {
      visibleInstances: this.currentRuntime.visibleCount,
      drawBatches: this.renderer.stats().drawBatches,
    };
  }

  private applyVisibility(changed: readonly InstanceId[]): void {
    this.ensureAlive();
    if (changed.length === 0) return;
    const changedSlots = changed.flatMap((instanceId) => {
      const slot = this.currentRuntime.getInstanceSlot(instanceId);
      return slot === undefined ? [] : [slot];
    });
    if (this.batchDepth > 0) {
      for (const slot of changedSlots) this.pendingVisibility.add(slot);
    } else {
      this.renderer.updateVisibility(this.currentRuntime, changedSlots);
    }
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
    const resolved = resolveViewportResults(
      results,
      this.currentScene,
      this.currentRuntime,
      this.baseInteraction,
    );
    this.currentResults = resolved;
    this.currentInteraction = resolved.interaction;
    this.renderer.setDeformation(resolved.deformation ?? defaultDeformation);
  }

  private ensureAlive(): void {
    if (this.destroyed) throw new Error("FemViewport has been destroyed");
  }
}

function cssSize(canvas: HTMLCanvasElement): { readonly width: number; readonly height: number } {
  const rect = canvas.getBoundingClientRect();
  return { width: Math.max(1, rect.width), height: Math.max(1, rect.height) };
}

function installResize(canvas: HTMLCanvasElement, resize: () => void): () => void {
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
