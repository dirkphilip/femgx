import type { Camera } from "../camera/camera";
import type { BoxSelectionRect } from "../interaction/box-selection";
import type { InteractionState } from "../interaction/interaction";
import type { InteractionTarget, InteractionTargetFor } from "../interaction/target-types";
import type { DeviceLostInfo } from "../platform/device";
import type { ViewportBackground } from "../renderer/gpu-renderer";
import type { PartId } from "../geometry/part";
import type { EdgePickHit, InteractionGranularity, PickHit } from "../picking/types";
import type { AssemblyId, AssemblyOccurrenceId, PartOccurrenceId } from "../scene/types";
import type { Scene } from "../scene/scene";
import type { SceneUpdate } from "../scene/update";
import type { SceneOccurrences } from "../scene-runtime/occurrences";
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
 * partially applied scalar, deformation, orientation, or loads state installed.
 * @category Viewport lifecycle
 */
export type SceneUpdateOutcome =
  | {
      /** No authored result snapshot was active during the update. */
      readonly results: "none";
    }
  | {
      /** The active authored result snapshot remains valid and installed. */
      readonly results: "preserved";
    }
  | {
      /** The active authored result snapshot was invalid for the new scene and was cleared. */
      readonly results: "cleared";
      /** Actionable validation reason for clearing the result snapshot. */
      readonly reason: string;
    };

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
export interface ViewportOptions {
  /** Browser canvas whose CSS box and WebGPU backing surface are synchronized. */
  readonly canvas: HTMLCanvasElement;
  /** Immutable authored scene compiled into this viewport's live runtime. */
  readonly scene: Scene;
  /** Point-element screen-space diameter in CSS pixels (default 8). */
  readonly pointSizePixels?: number;
  /** FE node-annotation screen-space diameter in CSS pixels (default 6). */
  readonly nodeSizePixels?: number;
  /** Whether to render the default world-origin triad (default `true`). */
  readonly originTriad?: boolean;
  /** Optional host container for the renderer-owned orientation gizmo. */
  readonly orientationGizmo?: OrientationGizmoOptions;
  /** Initial immutable camera value; otherwise the viewport creates a fitted camera. */
  readonly camera?: Camera;
  /** Initial immutable interaction snapshot; otherwise an empty state is created. */
  readonly interaction?: InteractionState;
  /** Initial authored result snapshot, validated against the supplied scene. */
  readonly results?: ViewportResultsConfig;
  /** Initial renderer-owned background presentation. */
  readonly background?: ViewportBackground;
  /** Supported-path device supplied by a host that owns adapter selection. */
  readonly device?: GPUDevice;
  /** WebGPU power preference used only when the viewport requests its own device. */
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

/** Camera navigation and focus operations owned by one viewport. */
export interface ViewportView {
  /** Current immutable camera value. */
  readonly camera: Camera;
  /** Replaces the camera, optionally over a finite transition. */
  setCamera(camera: Camera, options?: CameraTransitionOptions): void;
  /** Fits the full placed scene in the viewport. */
  fit(options?: CameraTransitionOptions): void;
  /** Fits the currently selected targets, or the scene when none are selected. */
  fitSelection(options?: CameraTransitionOptions): void;
}

/** Interaction state and physical picking operations owned by one viewport. */
export interface ViewportInteraction {
  /** Current immutable host interaction snapshot. */
  readonly state: InteractionState;
  /** Replaces the immutable host interaction snapshot. */
  set(interaction: InteractionState): void;
  /** Reads the nearest authored edge at canvas CSS coordinates. */
  pick(x: number, y: number, granularity: "edge"): Promise<EdgePickHit | undefined>;
  /** Reads the topmost rendered target, or accepts a dynamic edge-only mode. */
  pick(x: number, y: number, granularity?: "edge"): Promise<PickHit | undefined>;
  /** Resolves unique visible targets intersecting a canvas-space rectangle. */
  pickRegion(
    rect: BoxSelectionRect,
    granularity: "part",
  ): Promise<readonly InteractionTargetFor<"part">[]>;
  /** Resolves visible placed-part occurrences intersecting a canvas-space rectangle. */
  pickRegion(
    rect: BoxSelectionRect,
    granularity: "partOccurrence",
  ): Promise<readonly InteractionTargetFor<"partOccurrence">[]>;
  /** Resolves visible bodies intersecting a canvas-space rectangle. */
  pickRegion(
    rect: BoxSelectionRect,
    granularity: "body",
  ): Promise<readonly InteractionTargetFor<"body">[]>;
  /** Resolves visible authored elements intersecting a canvas-space rectangle. */
  pickRegion(
    rect: BoxSelectionRect,
    granularity: "element",
  ): Promise<readonly InteractionTargetFor<"element">[]>;
  /** Resolves visible authored faces intersecting a canvas-space rectangle. */
  pickRegion(
    rect: BoxSelectionRect,
    granularity: "face",
  ): Promise<readonly InteractionTargetFor<"face">[]>;
  /** Resolves visible authored nodes intersecting a canvas-space rectangle. */
  pickRegion(
    rect: BoxSelectionRect,
    granularity: "node",
  ): Promise<readonly InteractionTargetFor<"node">[]>;
  /** Resolves visible authored edges intersecting a canvas-space rectangle. */
  pickRegion(
    rect: BoxSelectionRect,
    granularity: "edge",
  ): Promise<readonly InteractionTargetFor<"edge">[]>;
  /** Dynamic-granularity fallback retaining the complete target union. */
  pickRegion(
    rect: BoxSelectionRect,
    granularity: InteractionGranularity,
  ): Promise<readonly InteractionTarget[]>;
}

/** Visibility mutations against the active scene and expanded runtime. */
export interface ViewportVisibility {
  /**
   * Applies a viewport-local convenience policy to every current and future
   * occurrence of one reusable part without mutating the part or scene.
   * @throws {UnknownSceneIdentityError} when `partId` is not registered.
   */
  setPartVisible(partId: PartId, visible: boolean): void;
  /**
   * Changes live visibility for one expanded assembly occurrence.
   * @throws {UnknownSceneIdentityError} when `occurrenceId` is absent.
   */
  setAssemblyOccurrenceVisible(occurrenceId: AssemblyOccurrenceId, visible: boolean): void;
  /**
   * Changes live visibility for every expanded occurrence of one assembly definition.
   * @throws {UnknownSceneIdentityError} when `assemblyId` is not registered.
   */
  setAssemblyVisible(assemblyId: AssemblyId, visible: boolean): void;
  /**
   * Changes live visibility for one expanded placed-part occurrence.
   * @throws {UnknownSceneIdentityError} when `partOccurrenceId` is absent.
   */
  setPartOccurrenceVisible(partOccurrenceId: PartOccurrenceId, visible: boolean): void;
  /**
   * Changes live visibility for many placed-part occurrences in one atomic update.
   * @throws {UnknownSceneIdentityError} when any supplied id is absent.
   */
  setPartOccurrences(partOccurrenceIds: Iterable<PartOccurrenceId>, visible: boolean): void;
}

/** Authored result state and atomic result replacement operations. */
export interface ViewportResults {
  /** Current resolved authored result snapshot, or `undefined` when cleared. */
  readonly state: ViewportResultsState | undefined;
  /** Atomically replaces the active authored result snapshot. */
  set(results: ViewportResultsConfig): void;
  /** Clears every active authored result role. */
  clear(): void;
}

/** Renderer-owned presentation and clipping controls. */
export interface ViewportPresentation {
  /** Current world-space clipping plane, or `undefined` when clipping is cleared. */
  readonly sectionPlane: SectionPlane | undefined;
  /** Clips scene geometry to the positive side of one world-space plane. */
  setSectionPlane(plane: SectionPlane): void;
  /** Clears the active world-space section plane. */
  clearSectionPlane(): void;
  /** Updates the renderer-owned background presentation. */
  setBackground(background: ViewportBackground): void;
  /** Sets the point-element screen-space diameter in CSS pixels. */
  setPointSizePixels(size: number): void;
  /** Sets the FE node-annotation screen-space diameter in CSS pixels. */
  setNodeSizePixels(size: number): void;
  /** Enables or disables depth testing for rendered edges. */
  setEdgeDepthTest(enabled: boolean): void;
}

/**
 * Canonical scene, rendering, and lifecycle owner.
 *
 * `Viewport` is the sole public rendering lifecycle. It consumes one
 * immutable {@link Scene}, owns its derived live occurrence view, and
 * exposes stable, non-owning capability facades for camera/navigation,
 * interaction/picking, visibility, results, and presentation. Runtime slots,
 * GPU buffers, and renderer construction are intentionally not public API.
 *
 * Call {@link destroy} when the host removes the viewport. `destroy` releases
 * viewport-owned listeners and resources; listeners installed by the host must
 * be removed by the host.
 * @category Start here
 */
export interface Viewport {
  /** The authoritative immutable scene currently compiled by this viewport. */
  readonly scene: Scene;
  /**
   * Stable live query facade over expanded placements. It exposes stable
   * handles and defensive query objects, not packed slots or renderer draw
   * order.
   */
  readonly occurrences: SceneOccurrences;
  /** Stable camera and navigation capability view. */
  readonly view: ViewportView;
  /** Stable interaction and picking capability view. */
  readonly interaction: ViewportInteraction;
  /** Stable scene visibility capability view. */
  readonly visibility: ViewportVisibility;
  /** Stable authored results capability view. */
  readonly results: ViewportResults;
  /** Stable renderer presentation capability view. */
  readonly presentation: ViewportPresentation;
  /**
   * Builds and applies one atomic structural scene update while preserving the
   * camera and valid placement-scoped state; invalid references are pruned.
   *
   * The callback must be synchronous and its editor must not escape. The
   * viewport publishes one immutable scene snapshot after the complete
   * candidate validates. A semantic no-op retains the existing scene and
   * packed state while this occurrence facade remains live after a committed update.
   */
  updateScene(operation: (update: SceneUpdate) => void): SceneUpdateOutcome;
  /** Replaces the scene and resets placement-scoped state. */
  replaceScene(scene: Scene): void;
  /**
   * Groups synchronous mutations into one deferred invalidation and render.
   * This coalesces viewport work only; it does not replace immutable bulk
   * interaction helpers such as `setTargetsSelected`.
   */
  batch<T>(operation: () => T): T;
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
  /** Returns lightweight visible-part-occurrence and draw-batch counts. */
  stats(): ViewportStats;
}

/** Lightweight counters describing the latest rendered viewport state. */
export interface ViewportStats {
  /** Number of currently visible expanded part occurrences. */
  readonly visiblePartOccurrences: number;
  /** Number of renderer draw batches in the latest frame. */
  readonly drawBatches: number;
}

/**
 * A visibility identity was not present in the active viewport scene/runtime.
 * Catch this error to distinguish a stale or misspelled host id from a valid
 * visibility no-op.
 * @category Viewport lifecycle
 */
export type { UnknownSceneIdentityError } from "./visibility-error";
