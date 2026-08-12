import type { Camera } from "../camera/camera";
import type { Vec3 } from "../math/vec3";
import type { Part } from "../geometry/part";
import type { InteractionState } from "../interaction/interaction";
import type { DeviceLostInfo } from "../platform/device";
import type { DeformationState } from "../results/deform";
import type { PackedSceneRuntime } from "../scene-runtime/runtime";
import type { PartId } from "../geometry/part";
import type { PickHit } from "../picking/types";

/** Options for creating a WebGPU renderer. */
export interface WebGpuRendererOptions {
  readonly canvas: HTMLCanvasElement;
  readonly device?: GPUDevice;
  readonly powerPreference?: GPUPowerPreference;
  /** Screen-space diameter of point elements in CSS pixels (default 8). */
  readonly pointSizePixels?: number;
  /** Called with a typed reason when the underlying GPU device is lost. */
  readonly onDeviceLost?: (info: DeviceLostInfo) => void;
}

/** Public WebGPU renderer contract used by the viewport and advanced hosts. */
export interface WebGpuRenderer {
  render(runtime: PackedSceneRuntime, camera: Camera, parts: ReadonlyMap<PartId, Part>): void;
  /** Sets or clears the per-frame CPU deformation state. */
  setDeformation(deformation: DeformationState | undefined): void;
  /** Writes only GPU subranges affected by changed instance slots. */
  updateInstances(
    runtime: PackedSceneRuntime,
    interaction: InteractionState,
    changedInstanceIds: readonly number[],
  ): void;
  /** Writes diffed emphasis records for bodies, elements, faces, and nodes. */
  updateElements(runtime: PackedSceneRuntime, interaction: InteractionState): void;
  /** Controls whether the edge overlay compares against the depth buffer. */
  setEdgeDepthTest(enabled: boolean): void;
  /** Controls the screen-space glyphs for finite-element nodes. */
  setNodeOverlay(enabled: boolean): void;
  /** Shows the library-styled world-space rotation pivot, or clears it. */
  setOrbitPivot(pivot: Vec3 | undefined): void;
  /** Rebuilds draw order after runtime visibility changes. */
  updateVisibility(runtime: PackedSceneRuntime, changedInstanceIds: readonly number[]): void;
  /** Picks the deepest physical hit under a CSS-local canvas pixel. */
  pick(x: number, y: number): Promise<PickHit | undefined>;
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
