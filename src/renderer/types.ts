import type { Camera } from "../camera/camera";
import type { BoxSelectionRect } from "../interaction/box-selection";
import type { Vec3 } from "../math/vec3";
import type { Part } from "../geometry/part";
import type { InteractionState } from "../interaction/interaction";
import type { DeviceLostInfo } from "../platform/device";
import type { DeformationState } from "../results/deform";
import type { PackedSceneRuntime } from "../scene-runtime/runtime";
import type { PartId } from "../geometry/part";
import type { PickHit } from "../picking/types";
import type { InteractionGranularity } from "../picking/types";
import type { InteractionTarget } from "../interaction/target-types";
import type { SectionPlane } from "../math/section-plane";

/** Built-in WebGPU viewport background presentations. */
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

/** Public WebGPU renderer contract used by the viewport and advanced hosts. */
export interface WebGpuRenderer {
  render(
    runtime: PackedSceneRuntime,
    camera: Camera,
    parts: ReadonlyMap<PartId, Part>,
    originTriadNominalScale?: number,
  ): void;
  /** Invalidates cached geometry before a viewport scene replacement. */
  resetScene(): void;
  /** Sets or clears the per-frame CPU deformation state. */
  setDeformation(deformation: DeformationState | undefined): void;
  /** Sets or clears renderer-owned nodal scalar color buffers. */
  setResultColors(colors: ReadonlyMap<PartId, Float32Array> | undefined): void;
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
  /** Controls whether the edge overlay compares against the depth buffer. */
  setEdgeDepthTest(enabled: boolean): void;
  /** Changes the WebGPU-rendered viewport background presentation. */
  setBackground(background: ViewportBackground): void;
  /** Changes the point-element screen-space diameter in CSS pixels. */
  setPointSizePixels(size: number): void;
  /** Changes the FE node-annotation screen-space diameter in CSS pixels. */
  setNodeSizePixels(size: number): void;
  /** Shows the library-styled world-space rotation pivot, or clears it. */
  setOrbitPivot(pivot: Vec3 | undefined): void;
  /** Rebuilds draw order after runtime visibility changes. */
  updateVisibility(runtime: PackedSceneRuntime, changedInstanceIds: readonly number[]): void;
  /** Picks the deepest physical hit under a CSS-local canvas pixel. */
  pick(x: number, y: number): Promise<PickHit | undefined>;
  pickRegion(
    rect: BoxSelectionRect,
    granularity: InteractionGranularity,
  ): Promise<readonly InteractionTarget[]>;
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
