import type { Camera } from "../camera/camera";
import type { BoxSelectionRect } from "../interaction/box-selection";
import type { InteractionState } from "../interaction/interaction";
import type { InteractionTarget } from "../interaction/target-types";
import type { DeviceLostInfo } from "../platform/device";
import type { ViewportBackground } from "../renderer/gpu-renderer";
import type { PartId } from "../geometry/part";
import type { InteractionGranularity, PickHit } from "../picking/types";
import type { AssemblyId, AssemblyOccurrenceId, InstanceId } from "../scene/types";
import type { Scene } from "../scene/scene";
import type { SceneRuntime } from "../scene-runtime/public-runtime";
import type { OrientationGizmoOptions } from "./orientation-gizmo";
import type { ViewportResultsConfig, ViewportResultsState } from "./results";
import type { CameraContentInset } from "../camera/fit";
import type { SectionPlane } from "../math/section-plane";

/**
 * Options for an interruptible viewport camera transition.
 * @category Viewport lifecycle
 */
export interface CameraTransitionOptions {
  /** Non-negative transition duration in milliseconds; zero applies immediately. */
  readonly durationMs?: number;
}

export type { ViewportBackground } from "../renderer/gpu-renderer";
export type { SectionPlane } from "../math/section-plane";

/**
 * Outcome of reapplying the active authored results to an updated scene.
 *
 * `updateScene` preserves a result snapshot only when its fields still cover
 * the candidate scene. A cleared result is reported instead of leaving a
 * partially applied scalar, deformation, or orientation state installed.
 * @category Viewport lifecycle
 */
export interface SceneUpdateOutcome {
  /** Whether active authored result data remained valid after the update. */
  readonly results: "none" | "preserved" | "cleared";
  /** Validation reason when active results were cleared. */
  readonly reason?: string;
}

/**
 * Inputs for the opinionated WebGPU FEM viewport.
 *
 * `canvas` and `scene` are the only required inputs. The viewport owns the
 * current camera, compiled runtime, WebGPU renderer, resize synchronization,
 * standard controls, and teardown. Hosts own DOM event wiring and may supply
 * an existing camera, interaction snapshot, authored result snapshot, or
 * supported-path device. A missing or unusable WebGPU device is reported as a
 * typed unsupported failure; this option set does not enable a CPU fallback.
 * @category Viewport lifecycle
 */
export interface FemViewportOptions {
  readonly canvas: HTMLCanvasElement;
  readonly scene: Scene;
  /** Point-element screen-space diameter in CSS pixels (default 8). */
  readonly pointSizePixels?: number;
  /** FE node-annotation screen-space diameter in CSS pixels (default 6). */
  readonly nodeSizePixels?: number;
  /** Whether to render the default world-origin triad (default `true`). */
  readonly originTriad?: boolean;
  readonly orientationGizmo?: OrientationGizmoOptions;
  readonly camera?: Camera;
  readonly interaction?: InteractionState;
  readonly results?: ViewportResultsConfig;
  readonly background?: ViewportBackground;
  readonly device?: GPUDevice;
  readonly powerPreference?: GPUPowerPreference;
  /** Reports terminal or recoverable WebGPU device loss. */
  readonly onDeviceLost?: (info: DeviceLostInfo) => void;
  /** Reports successful device recovery after loss. */
  readonly onRecovered?: () => void;
  /** Receives asynchronous viewport or renderer failures. */
  readonly onError?: (error: unknown) => void;
  /** Reports whether a camera or pointer gesture is active. */
  readonly onGestureChange?: (active: boolean) => void;
  /** Notifies the host after a frame is submitted. */
  readonly onRender?: () => void;
  /** Optional host-owned target for the core `Z` fit-selection shortcut. */
  readonly keyboardTarget?: EventTarget;
  /** Optional host-owned occlusion reported when fitting the scene. */
  readonly fitContentInset?: () => CameraContentInset;
}

/**
 * Canonical scene, camera, interaction, rendering, and lifecycle owner.
 *
 * `FemViewport` is the sole public rendering lifecycle. It consumes one
 * immutable {@link Scene}, owns its derived live {@link SceneRuntime}, and
 * exposes host-facing mutations for visibility, interaction, results, camera,
 * and structural scene updates. Runtime slots, GPU buffers, and renderer
 * construction are intentionally not public API.
 *
 * Picking returns physical hits; use {@link interactionTargetFromHit} to map a
 * hit to the stable target identity that the host wants to select or hover.
 * Call {@link destroy} when the host removes the viewport. `destroy` releases
 * viewport-owned listeners and resources; listeners installed by the host must
 * be removed by the host.
 * @category Start here
 */
export interface FemViewport {
  readonly scene: Scene;
  /**
   * The current live query facade. Read it again after `setScene` or
   * `updateScene`; structural replacement installs a new runtime snapshot.
   * The facade exposes stable handles and defensive query objects, not packed
   * slots or renderer draw order.
   */
  readonly runtime: SceneRuntime;
  readonly camera: Camera;
  readonly interaction: InteractionState;
  readonly results: ViewportResultsState | undefined;
  readonly sectionPlane: SectionPlane | undefined;
  /** Sets the point-element screen-space diameter in CSS pixels. */
  setPointSizePixels(size: number): void;
  /** Sets the FE node-annotation screen-space diameter in CSS pixels. */
  setNodeSizePixels(size: number): void;
  /**
   * Applies a structural scene update while preserving the camera and valid
   * placement-scoped state; invalid interaction references are pruned.
   *
   * The candidate is compiled before it is committed. Unlike {@link setScene},
   * this revalidates the active results configuration and reports whether it
   * was preserved or cleared. Re-read {@link runtime} after this call.
   */
  updateScene(scene: Scene): SceneUpdateOutcome;
  /** Replaces the scene and resets placement-scoped state; re-read {@link runtime}. */
  setScene(scene: Scene): void;
  /** Applies a camera change, optionally over a finite transition. */
  setCamera(camera: Camera, options?: CameraTransitionOptions): void;
  /** Fits the full placed scene in the viewport. */
  fitView(options?: CameraTransitionOptions): void;
  /** Fits the currently selected targets, or the scene when none are selected. */
  fitSelection(options?: CameraTransitionOptions): void;
  /** Replaces the immutable host interaction snapshot and synchronizes the renderer. */
  setInteraction(interaction: InteractionState): void;
  /** Groups synchronous mutations into one deferred invalidation and render. */
  batch<T>(operation: () => T): T;
  /** Atomically replaces the active authored scalar/deformation/vector result snapshot. */
  setResults(results: ViewportResultsConfig): void;
  /** Clears every active authored result role. */
  clearResults(): void;
  /** Clips scene geometry to the positive side of one world-space plane. */
  setSectionPlane(plane: SectionPlane): void;
  /** Clears the active world-space section plane. */
  clearSectionPlane(): void;
  /** Updates the renderer-owned background presentation. */
  setBackground(background: ViewportBackground): void;
  /** Enables or disables depth testing for rendered edges. */
  setEdgeDepthTest(enabled: boolean): void;
  /** Changes visibility for every occurrence of one part definition. */
  setPartVisible(partId: PartId, visible: boolean): void;
  /** Changes visibility for one assembly occurrence. */
  setAssemblyOccurrenceVisible(occurrenceId: AssemblyOccurrenceId, visible: boolean): void;
  /** Changes visibility for every occurrence of one assembly definition. */
  setAssemblyVisible(assemblyId: AssemblyId, visible: boolean): void;
  /** Changes visibility for one placed-part occurrence. */
  setInstanceVisible(instanceId: InstanceId, visible: boolean): void;
  /**
   * Reads the topmost rendered target at canvas CSS coordinates.
   *
   * The optional `"edge"` granularity requests authored FE-edge identity;
   * tessellation diagonals are never returned as edges. The promise resolves
   * to `undefined` when no visible rendered target is under the coordinate.
   */
  pick(x: number, y: number, granularity?: "edge"): Promise<PickHit | undefined>;
  /**
   * Resolves unique visible targets intersecting a canvas-space rectangle.
   *
   * This is nearest-visible GPU region discovery and does not mutate selection.
   * A host that needs element Through selection should combine
   * `boxSelectionFrustum` with authoritative placed FE geometry instead.
   */
  pickRegion(
    rect: BoxSelectionRect,
    granularity: InteractionGranularity,
  ): Promise<readonly InteractionTarget[]>;
  /** Synchronizes the canvas backing size with its host layout. */
  resize(): void;
  /** Schedules one render without changing scene or interaction state. */
  invalidate(): void;
  /** Submits the current frame immediately. */
  render(): void;
  /** Attempts supported-path WebGPU device recovery while retaining scene and latest results. */
  recover(): Promise<void>;
  /** Releases viewport-owned renderer/runtime resources and library-installed listeners. */
  destroy(): void;
  /** Returns lightweight visible-instance and draw-batch counts. */
  stats(): { readonly visibleInstances: number; readonly drawBatches: number };
}
