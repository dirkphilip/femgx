import type { DeformationState } from "../../results/deform";
import type { SectionPlane } from "../../math/section-plane";
import type { DrawCall, DrawResources } from "../resources/draw-resources";
import type { PickTargets } from "../picking/pick";
import type { RenderResources } from "./pipelines";
import type { GpuTimestampRecorder } from "../diagnostics/timestamps";
import type { ResultColorMap } from "../../results/colors";
import type { SectionCapFrame } from "../section-caps";

/** Everything the per-frame command encoding needs from the renderer. */
export interface FrameOptions {
  readonly canvas: HTMLCanvasElement;
  readonly context: GPUCanvasContext;
  readonly device: GPUDevice;
  readonly draw: DrawResources;
  readonly resources: RenderResources;
  /** Swap-chain / MSAA color format matching the configured canvas context. */
  readonly colorFormat: GPUTextureFormat;
  readonly calls: readonly DrawCall[];
  readonly transparentCalls: readonly DrawCall[];
  readonly edgeCalls: readonly DrawCall[];
  readonly nodeCalls: readonly DrawCall[];
  readonly selectionCalls: readonly DrawCall[];
  readonly selectedNodeCalls: readonly DrawCall[];
  /** Whether static exterior face orders remain valid for ordinary and pick draws. */
  readonly usesExteriorFaceSubsets: boolean;
  readonly capCalls?: readonly DrawCall[];
  readonly transparentCapCalls?: readonly DrawCall[];
  readonly allCapCalls?: readonly DrawCall[];
  /** Generated cap state owned by the active section-cap frame. */
  readonly sectionCaps: SectionCapFrame | undefined;
  readonly pickTargets: PickTargets;
  readonly depthFormat: GPUTextureFormat;
  /** Whether the edge overlay culls edges occluded by depth (`less`). */
  readonly edgeDepthTest: boolean;
  /** Screen-space diameter of point elements in CSS pixels. */
  readonly pointSize: number;
  /** Screen-space diameter of FE node annotations in CSS pixels. */
  readonly nodeSize: number;
  /** Per-frame deformation state; `undefined` disables GPU deformation. */
  readonly deformation: DeformationState | undefined;
  /** Single world-space section plane; `undefined` leaves the scene unclipped. */
  readonly sectionPlane: SectionPlane | undefined;
  /** Per-part dense scalar colors, or `undefined` when result coloring is off. */
  readonly resultColors: ResultColorMap | undefined;
  /** Active world-space camera spin pivot. */
  readonly orbitPivot: readonly [number, number, number] | undefined;
  /** Whether the construction-time world-origin triad is enabled. */
  readonly originTriadEnabled: boolean;
  /** Stable bounds-derived world scale before the per-camera cap. */
  readonly originTriadNominalScale: number;
  /** Current display density used by fixed-size presentation helpers. */
  readonly devicePixelRatio: number;
  /** Optional benchmark-only pass timestamp owner. */
  readonly timestampRecorder?: GpuTimestampRecorder;
}
