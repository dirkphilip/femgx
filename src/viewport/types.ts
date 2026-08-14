import type { Camera } from "../camera/camera";
import type { BoxSelectionRect } from "../interaction/box-selection";
import type { InteractionState } from "../interaction/interaction";
import type { InteractionTarget } from "../interaction/target-types";
import type { DeviceLostInfo } from "../platform/device";
import type { ViewportBackground } from "../renderer/gpu-renderer";
import type { PartId } from "../geometry/part";
import type { InteractionGranularity, PickHit } from "../picking/types";
import type { AssemblyId, AssemblyNodeId, InstanceId } from "../scene/types";
import type { Scene } from "../scene/scene";
import type { SceneRuntime } from "../scene-runtime/public-runtime";
import type { OrientationGizmoOptions } from "./orientation-gizmo";
import type { ViewportResultsConfig, ViewportResultsState } from "./results";
import type { CameraContentInset } from "../camera/fit";
import type { SectionPlane } from "./section-plane";

/** Options for an interruptible viewport camera transition. */
export interface CameraTransitionOptions {
  /** Non-negative transition duration in milliseconds; zero applies immediately. */
  readonly durationMs?: number;
}

export type { ViewportBackground } from "../renderer/gpu-renderer";
export type { SectionPlane } from "./section-plane";

/** Outcome of reapplying the active authored results to an updated scene. */
export interface SceneUpdateOutcome {
  /** Whether active authored result data remained valid after the update. */
  readonly results: "none" | "preserved" | "cleared";
  /** Validation reason when active results were cleared. */
  readonly reason?: string;
}

/** Inputs for the opinionated WebGPU FEM viewport. */
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
  readonly onDeviceLost?: (info: DeviceLostInfo) => void;
  readonly onRecovered?: () => void;
  readonly onError?: (error: unknown) => void;
  readonly onGestureChange?: (active: boolean) => void;
  readonly onRender?: () => void;
  /** Optional host-owned target for the core `Z` fit-selection shortcut. */
  readonly keyboardTarget?: EventTarget;
  /** Optional host-owned occlusion reported when fitting the scene. */
  readonly fitContentInset?: () => CameraContentInset;
}

/** Canonical scene, camera, interaction, rendering, and lifecycle owner. */
export interface FemViewport {
  readonly scene: Scene;
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
   * Unlike {@link setScene}, this revalidates the active results configuration
   * and reports whether it was preserved or cleared.
   */
  updateScene(scene: Scene): SceneUpdateOutcome;
  setScene(scene: Scene): void;
  setCamera(camera: Camera, options?: CameraTransitionOptions): void;
  fitView(options?: CameraTransitionOptions): void;
  fitSelection(options?: CameraTransitionOptions): void;
  setInteraction(interaction: InteractionState): void;
  /** Groups synchronous mutations into one deferred invalidation and render. */
  batch<T>(operation: () => T): T;
  setResults(results: ViewportResultsConfig): void;
  clearResults(): void;
  /** Clips scene geometry to the positive side of one world-space plane. */
  setSectionPlane(plane: SectionPlane): void;
  /** Clears the active world-space section plane. */
  clearSectionPlane(): void;
  setBackground(background: ViewportBackground): void;
  setEdgeDepthTest(enabled: boolean): void;
  setPartVisible(partId: PartId, visible: boolean): void;
  setAssemblyNodeVisible(nodeId: AssemblyNodeId, visible: boolean): void;
  setAssemblyVisible(assemblyId: AssemblyId, visible: boolean): void;
  setInstanceVisible(instanceId: InstanceId, visible: boolean): void;
  pick(x: number, y: number): Promise<PickHit | undefined>;
  pickRegion(
    rect: BoxSelectionRect,
    granularity: InteractionGranularity,
  ): Promise<readonly InteractionTarget[]>;
  resize(): void;
  invalidate(): void;
  render(): void;
  recover(): Promise<void>;
  destroy(): void;
  stats(): { readonly visibleInstances: number; readonly drawBatches: number };
}
