import type { SectionPlane } from "../../math/section-plane";
import type { DeformationState } from "../../results/deform";
import type { GpuBundle } from "../recovery";
import type { FrameOptions } from "./frame-types";
import type { DrawCall } from "../resources/draw-resources";
import type { GpuTimestampRecorder } from "../diagnostics/timestamps";
import type { ResultColorMap } from "../../results/colors";

const EMPTY_CALLS: readonly DrawCall[] = [];

interface FrameOptionSources {
  readonly canvas: HTMLCanvasElement;
  readonly context: GPUCanvasContext;
  readonly bundle: GpuBundle;
  readonly attachment: {
    readonly calls: FrameOptions["calls"];
    readonly transparentCalls: FrameOptions["transparentCalls"];
    readonly edgeCalls: FrameOptions["edgeCalls"];
    readonly nodeCalls: FrameOptions["nodeCalls"];
    readonly selectionCalls: FrameOptions["selectionCalls"];
    readonly selectedNodeCalls: FrameOptions["selectedNodeCalls"];
    readonly usesExteriorFaceSubsets: boolean;
  };
  readonly capCalls?: FrameOptions["capCalls"];
  readonly transparentCapCalls?: FrameOptions["transparentCapCalls"];
  readonly allCapCalls?: FrameOptions["allCapCalls"];
  readonly colorFormat: GPUTextureFormat;
  readonly depthFormat: GPUTextureFormat;
  readonly edgeDepthTest: boolean;
  readonly pointSize: number;
  readonly nodeSize: number;
  readonly deformation: DeformationState | undefined;
  readonly sectionPlane: SectionPlane | undefined;
  readonly resultColors: ResultColorMap | undefined;
  readonly orbitPivot: readonly [number, number, number] | undefined;
  readonly originTriadEnabled: boolean;
  readonly originTriadNominalScale: number;
  readonly timestampRecorder: GpuTimestampRecorder | undefined;
}

/** Builds the immutable frame input record from current renderer state. */
export function buildFrameOptions(options: FrameOptionSources): FrameOptions {
  return {
    canvas: options.canvas,
    context: options.context,
    device: options.bundle.device,
    draw: options.bundle.draw,
    resources: options.bundle.resources,
    calls: options.attachment.calls,
    transparentCalls: options.attachment.transparentCalls,
    edgeCalls: options.attachment.edgeCalls,
    nodeCalls: options.attachment.nodeCalls,
    selectionCalls: options.attachment.selectionCalls,
    selectedNodeCalls: options.attachment.selectedNodeCalls,
    capCalls: options.capCalls ?? EMPTY_CALLS,
    transparentCapCalls: options.transparentCapCalls ?? EMPTY_CALLS,
    allCapCalls: options.allCapCalls ?? EMPTY_CALLS,
    usesExteriorFaceSubsets: options.attachment.usesExteriorFaceSubsets,
    pickTargets: options.bundle.pickTargets,
    colorFormat: options.colorFormat,
    depthFormat: options.depthFormat,
    edgeDepthTest: options.edgeDepthTest,
    pointSize: options.pointSize,
    nodeSize: options.nodeSize,
    deformation: options.deformation,
    sectionPlane: options.sectionPlane,
    resultColors: options.resultColors,
    orbitPivot: options.orbitPivot,
    originTriadEnabled: options.originTriadEnabled,
    originTriadNominalScale: options.originTriadNominalScale,
    ...(options.timestampRecorder === undefined
      ? {}
      : { timestampRecorder: options.timestampRecorder }),
    devicePixelRatio,
  };
}
