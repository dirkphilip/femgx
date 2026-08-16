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
import type { AssemblyId, AssemblyOccurrenceId, InstanceId } from "../scene/types";
import { SceneNavigationBoundsCache } from "./scene-bounds";
import {
  assertViewportBackground,
  cssSize,
  installResize,
  installViewportKeyboard,
  validateOrientationGizmo,
} from "./dom";
import { CameraFocusController } from "./camera-focus";
import { normalizeSectionPlane, type SectionPlane } from "../math/section-plane";
import { flushViewportBatch } from "./batch";
import { assertOriginTriad, sceneOriginTriadScale } from "./origin-triad";
import type { DeformationState } from "../results/deform";
import { createOrientationGizmo, type OrientationGizmoHandle } from "./orientation-gizmo";
import {
  resolveViewportInteraction,
  resolveViewportResults,
  type ViewportResultsConfig,
  type ViewportResultsState,
} from "./results";
import { applyResolvedViewportResults, applyViewportResults } from "./results-application";
import type {
  CameraTransitionOptions,
  FemViewport,
  FemViewportOptions,
  SceneUpdateOutcome,
  ViewportBackground,
} from "./types";
import { preserveRuntimeVisibility, reconcileInteractionState } from "./scene-reconciliation";
export type {
  FemViewport,
  FemViewportOptions,
  SceneUpdateOutcome,
  ViewportBackground,
} from "./types";

interface PreparedSceneReplacement {
  readonly scene: Scene;
  readonly runtime: PackedSceneRuntime;
  readonly publicRuntime: SceneRuntime;
  readonly originTriadNominalScale: number;
  readonly baseInteraction: InteractionState;
  readonly effectiveInteraction: InteractionState;
  readonly results: ViewportResultsState | undefined;
  readonly outcome: SceneUpdateOutcome;
}

/**
 * Creates a fitted, interactive FEM viewport backed only by WebGPU.
 *
 * This asynchronous factory requests the supported-path adapter/device,
 * compiles the supplied {@link root.Scene}, creates a fitted camera, installs
 * standard canvas controls and resize synchronization, and returns the sole
 * public lifecycle owner. It rejects with {@link root.WebGpuUnsupportedError} when
 * the browser cannot provide a working WebGPU device; there is no CPU renderer
 * fallback. A device loss can be reported through `onDeviceLost` and recovered
 * with {@link root.FemViewport.recover}.
 * @example Create and destroy a viewport.
 * ```ts
 * import { createFemViewport, createPart, createScene, identity } from "femgx";
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
 * const viewport = await createFemViewport({ canvas, scene });
 * // The host removes its own event listeners before destroying the viewport.
 * viewport.destroy();
 * ```
 * @category Start here
 */
export async function createFemViewport(options: FemViewportOptions): Promise<FemViewport> {
  assertViewportBackground(options.background);
  assertOriginTriad(options.originTriad);
  assertPixelSize("pointSizePixels", options.pointSizePixels);
  assertPixelSize("nodeSizePixels", options.nodeSizePixels);
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
    ...(options.pointSizePixels === undefined ? {} : { pointSizePixels: options.pointSizePixels }),
    ...(options.nodeSizePixels === undefined ? {} : { nodeSizePixels: options.nodeSizePixels }),
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
  private currentSectionPlane: SectionPlane | undefined;
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
  private pointSizePixels: number;
  private nodeSizePixels: number;
  private originTriadNominalScale: number;
  private readonly navigationBoundsCache = new SceneNavigationBoundsCache();

  constructor(
    private readonly options: FemViewportOptions,
    private readonly renderer: WebGpuRenderer,
  ) {
    this.currentScene = options.scene;
    this.background = options.background ?? "studio";
    this.pointSizePixels = options.pointSizePixels ?? 8;
    this.nodeSizePixels = options.nodeSizePixels ?? 6;
    this.currentRuntime = createPackedSceneRuntime(options.scene);
    this.originTriadNominalScale = sceneOriginTriadScale(options.scene, this.currentRuntime);
    this.currentPublicRuntime = createPublicSceneRuntime(this.currentRuntime);
    this.effectiveInteraction = this.baseInteraction =
      options.interaction ?? createInteractionState();
    this.cameraRef = { camera: options.camera ?? createCamera() };
    const deformation = () => this.currentResults?.deformation;
    const navigationBounds = () =>
      this.navigationBoundsCache.get(this.currentScene, this.currentRuntime, deformation());
    this.cameraFocus = this.createCameraFocus(options, deformation);
    this.removeKeyboard = installViewportKeyboard(options.keyboardTarget, () => {
      this.fitSelection();
    });
    assertValidCamera(this.cameraRef.camera);
    this.resize(false);
    this.removeControls = installCameraControlsWithProtectedBounds({
      canvas: options.canvas,
      cameraRef: this.cameraRef,
      navigation: renderer,
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
  get sectionPlane(): SectionPlane | undefined {
    return this.currentSectionPlane;
  }

  setScene(scene: Scene): void {
    this.ensureAlive();
    const replacement = this.prepareSceneReplacement(scene, false);
    this.installSceneReplacement(replacement, true);
  }

  updateScene(scene: Scene): SceneUpdateOutcome {
    this.ensureAlive();
    const replacement = this.prepareSceneReplacement(scene, true);
    this.installSceneReplacement(replacement, false);
    return replacement.outcome;
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
    applyResolvedViewportResults(this.renderer, undefined);
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
    this.applyVisibility(this.currentRuntime.setPartVisible(partId, visible).changedInstanceIds);
  }
  setAssemblyOccurrenceVisible(occurrenceId: AssemblyOccurrenceId, visible: boolean): void {
    this.ensureAlive();
    const node = this.currentRuntime.getNodeSlot(occurrenceId);
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
    const interactionChanged = this.appliedInteraction !== this.effectiveInteraction;
    const changed = interactionChanged
      ? changedInstanceSlots(
          this.currentRuntime,
          this.appliedInteraction,
          this.effectiveInteraction,
        )
      : [];
    if (changed.length > 0) {
      this.renderer.updateInstances(this.currentRuntime, this.effectiveInteraction, changed);
    }
    if (interactionChanged) {
      this.renderer.updateElements(this.currentRuntime, this.effectiveInteraction, changed);
    }
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
    this.navigationBoundsCache.invalidate();
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
    const applied = applyViewportResults({
      results,
      scene: this.currentScene,
      runtime: this.currentRuntime,
      interaction: this.baseInteraction,
      renderer: this.renderer,
      ...(this.currentResults === undefined ? {} : { previous: this.currentResults }),
    });
    this.currentResults = applied.results;
    this.effectiveInteraction = applied.interaction;
  }

  private prepareSceneReplacement(
    scene: Scene,
    preserveResults: boolean,
  ): PreparedSceneReplacement {
    const nextRuntime = createPackedSceneRuntime(scene);
    preserveRuntimeVisibility(this.currentRuntime, nextRuntime);
    const nextOriginTriadNominalScale = sceneOriginTriadScale(scene, nextRuntime);
    const nextPublicRuntime = createPublicSceneRuntime(nextRuntime);
    const nextInteraction = reconcileInteractionState(
      this.baseInteraction,
      nextRuntime,
      scene.parts,
    );
    const resultUpdate = preserveResults
      ? this.prepareSceneResults(scene, nextRuntime, nextInteraction)
      : { results: undefined, interaction: nextInteraction, outcome: { results: "none" as const } };
    return {
      scene,
      runtime: nextRuntime,
      publicRuntime: nextPublicRuntime,
      originTriadNominalScale: nextOriginTriadNominalScale,
      baseInteraction: nextInteraction,
      effectiveInteraction: resultUpdate.interaction,
      results: resultUpdate.results,
      outcome: resultUpdate.outcome,
    };
  }

  private installSceneReplacement(
    replacement: PreparedSceneReplacement,
    resetRenderer: boolean,
  ): void {
    if (resetRenderer) this.renderer.resetScene(replacement.scene.parts);
    this.cameraFocus.cancel();
    this.currentScene = replacement.scene;
    this.currentRuntime = replacement.runtime;
    this.originTriadNominalScale = replacement.originTriadNominalScale;
    this.currentPublicRuntime = replacement.publicRuntime;
    this.pendingVisibility.clear();
    this.currentResults = replacement.results;
    this.baseInteraction = replacement.baseInteraction;
    this.effectiveInteraction = replacement.effectiveInteraction;
    this.appliedInteraction = createInteractionState();
    applyResolvedViewportResults(this.renderer, replacement.results);
    this.invalidate();
  }

  private prepareSceneResults(
    scene: Scene,
    runtime: PackedSceneRuntime,
    interaction: InteractionState,
  ): {
    readonly results: ViewportResultsState | undefined;
    readonly interaction: InteractionState;
    readonly outcome: SceneUpdateOutcome;
  } {
    const previous = this.currentResults;
    if (previous === undefined) {
      return { results: undefined, interaction, outcome: { results: "none" } };
    }
    try {
      const results = resolveViewportResults(previous.config, scene, runtime, previous);
      return {
        results,
        interaction: resolveViewportInteraction(interaction, results, scene, runtime),
        outcome: { results: "preserved" },
      };
    } catch (error: unknown) {
      return {
        results: undefined,
        interaction,
        outcome: { results: "cleared", reason: errorMessage(error) },
      };
    }
  }

  private ensureAlive(): void {
    if (this.destroyed) throw new Error("FemViewport has been destroyed");
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function assertPixelSize(name: string, value: number | undefined): void {
  if (value === undefined) return;
  if (!Number.isFinite(value) || value < 1 || value > 64) {
    throw new RangeError(`${name} must be finite and in [1, 64] CSS pixels`);
  }
}
