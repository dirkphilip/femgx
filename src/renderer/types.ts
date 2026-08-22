import type { Camera } from "../camera/camera";
import type { BoxSelectionRect } from "../interaction/box-selection";
import type { Vec3 } from "../math/vec3";
import type { Part } from "../geometry/part";
import type { InteractionState } from "../interaction/interaction";
import type { DeviceLostInfo } from "../platform/device";
import type { PackedSceneRuntime } from "../scene-runtime/runtime";
import type { RuntimeOccurrenceDelta } from "../scene-runtime/occurrence-update";
import type { PartId } from "../geometry/part";
import type { PickHit } from "../picking/types";
import type { InteractionGranularity } from "../picking/types";
import type { InteractionTarget } from "../interaction/target-types";
import type { ElementRegionSelection } from "../interaction/element-region-selection";
import type { SectionPlane } from "../math/section-plane";
import type {
  PartRevisionResultState,
  RendererResultSnapshot,
} from "./attachment/part-revision-results";

/**
 * Built-in WebGPU viewport background presentations.
 * @category Viewport lifecycle
 */
export type ViewportBackground = "studio" | "white" | "dark";

/** Options for creating a WebGPU renderer. */
export interface WebGpuRendererOptions {
  readonly canvas: HTMLCanvasElement;
  readonly device?: GPUDevice;
  readonly powerPreference?: GPUPowerPreference;
  /** Screen-space diameter of point elements in CSS pixels (default 8). */
  readonly pointSizePixels?: number;
  /** Screen-space diameter of FE node annotations in CSS pixels (default 6). */
  readonly nodeSizePixels?: number;
  /** Initial WebGPU-rendered viewport background (default `studio`). */
  readonly background?: ViewportBackground;
  /** Whether to render the world-origin triad (default `true`). */
  readonly originTriad?: boolean;
  /** Called with a typed reason when the underlying GPU device is lost. */
  readonly onDeviceLost?: (info: DeviceLostInfo) => void;
}

/** Internal WebGPU renderer port used by the viewport and renderer diagnostics. */
export interface WebGpuRenderer {
  render(
    runtime: PackedSceneRuntime,
    camera: Camera,
    parts: ReadonlyMap<PartId, Part>,
    originTriadNominalScale?: number,
  ): void;
  /** Reconciles cached geometry before a viewport scene replacement. */
  resetScene(parts: ReadonlyMap<PartId, Part>): void;
  /** Atomically publishes or clears the complete renderer-owned result snapshot. */
  setResultSnapshot(results: RendererResultSnapshot | undefined): void;
  /** Sets or clears the single world-space scene clipping plane. */
  setSectionPlane(plane: SectionPlane | undefined): void;
  /** Writes only GPU subranges affected by changed instance slots. */
  updateInstances(
    runtime: PackedSceneRuntime,
    interaction: InteractionState,
    changedInstanceIds: readonly number[],
  ): void;
  /** Writes diffed emphasis records for bodies, elements, faces, and nodes. */
  updateElements(
    runtime: PackedSceneRuntime,
    interaction: InteractionState,
    changedInstanceIds?: readonly number[],
  ): void;
  /** Prepares a private occurrence revision without publishing it. */
  prepareOccurrenceUpdate(options: {
    readonly runtime: PackedSceneRuntime;
    readonly interaction: InteractionState;
    readonly delta: RuntimeOccurrenceDelta;
    readonly parts: ReadonlyMap<PartId, Part>;
    readonly results?: PartRevisionResultState;
    readonly replacedPartIds?: ReadonlySet<PartId>;
  }): PreparedRendererOccurrenceUpdate;
  /** Publishes one prepared occurrence revision. */
  commitOccurrenceUpdate(prepared: PreparedRendererOccurrenceUpdate): void;
  /** Discards one uncommitted occurrence revision. */
  discardOccurrenceUpdate(prepared: PreparedRendererOccurrenceUpdate): void;
  /** Prepares exact added definitions before the runtime is mutated. */
  preparePartAdditions(parts: ReadonlyMap<PartId, Part>, partIds: ReadonlySet<PartId>): void;
  /** Applies exact immutable part revisions. */
  updatePartRevisions(
    runtime: PackedSceneRuntime,
    interaction: InteractionState,
    parts: ReadonlyMap<PartId, Part>,
    partIds: ReadonlySet<PartId>,
    results: PartRevisionResultState,
  ): void;
  /** Controls whether the edge overlay compares against the depth buffer. */
  setEdgeDepthTest(enabled: boolean): void;
  /** Enables or disables the renderer-owned edge overlay. */
  setEdgesVisible(enabled: boolean): void;
  /** Enables or disables the renderer-owned node overlay. */
  setNodesVisible(enabled: boolean): void;
  /** Changes the WebGPU-rendered viewport background presentation. */
  setBackground(background: ViewportBackground): void;
  /** Changes the point-element screen-space diameter in CSS pixels. */
  setPointSizePixels(size: number): void;
  /** Changes the FE node-annotation screen-space diameter in CSS pixels. */
  setNodeSizePixels(size: number): void;
  /** Shows the library-styled world-space rotation pivot, or clears it. */
  setOrbitPivot(pivot: Vec3 | undefined): void;
  /** Rebuilds draw order after runtime visibility changes. */
  updateVisibility(runtime: PackedSceneRuntime, affectedPartIds: readonly PartId[]): void;
  /** Picks the deepest physical hit under a CSS-local canvas pixel. */
  pick(x: number, y: number, granularity?: "edge"): Promise<PickHit | undefined>;
  pickRegion(
    rect: BoxSelectionRect,
    granularity: InteractionGranularity,
  ): Promise<ElementRegionSelection | readonly InteractionTarget[]>;
  /** Returns the exact displayed world-space point under a CSS-local pixel. */
  pickPoint(camera: Camera, x: number, y: number): Promise<Vec3 | undefined>;
  resize(width?: number, height?: number): void;
  destroy(): void;
  stats(): { readonly drawBatches: number };
  /** True while the device is lost and awaiting recovery. */
  readonly lost: boolean;
  /** Re-creates the GPU device after a supported device loss. */
  recover(): Promise<void>;
  /** The GPU device backing the renderer. */
  readonly device: GPUDevice;
}

/** Opaque prepared occurrence payload exchanged across the viewport renderer port. */
export interface PreparedRendererOccurrenceUpdate<Attachment = unknown, Caps = unknown> {
  readonly attachment: Attachment;
  readonly caps: Caps;
  readonly runtime: PackedSceneRuntime;
  readonly interaction: InteractionState;
  readonly parts: ReadonlyMap<PartId, Part>;
  readonly results: PartRevisionResultState | undefined;
}
