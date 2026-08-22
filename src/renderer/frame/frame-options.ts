import type { SectionPlane } from "../../math/section-plane";
import type { DeformationState } from "../../results/deform";
import type { GpuBundle } from "../recovery";
import type { GpuDeviceLifecycle } from "../recovery";
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
  readonly sectionCaps: {
    readonly currentFrame:
      | {
          readonly calls: FrameOptions["capCalls"];
          readonly transparentCalls: FrameOptions["transparentCapCalls"];
          readonly allCalls: FrameOptions["allCapCalls"];
        }
      | undefined;
  };
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

/** Narrow renderer state boundary used to build one immutable frame snapshot. */
export interface RendererFrameOptionsOwner {
  readonly canvas: HTMLCanvasElement;
  readonly context: GPUCanvasContext;
  readonly lifecycle: Pick<GpuDeviceLifecycle, "bundle">;
  readonly attachment: FrameOptionSources["attachment"];
  readonly format: GPUTextureFormat;
  readonly depthFormat: GPUTextureFormat;
  readonly edgeDepthTest: boolean;
  readonly pointSize: number;
  readonly nodeSize: number;
  readonly deformation: DeformationState | undefined;
  readonly sectionPlane: SectionPlane | undefined;
  readonly sectionCaps: FrameOptionSources["sectionCaps"] & {
    readonly resultColors: ResultColorMap | undefined;
  };
  readonly orbitPivot: readonly [number, number, number] | undefined;
  readonly originTriadEnabled: boolean;
  readonly originTriadNominalScale: number;
  readonly timestampRecorder: GpuTimestampRecorder | undefined;
}

/** Builds a frame snapshot from the concrete renderer's live state. */
export function buildRendererFrameOptions(owner: RendererFrameOptionsOwner): FrameOptions {
  return buildFrameOptions({
    canvas: owner.canvas,
    context: owner.context,
    bundle: owner.lifecycle.bundle,
    attachment: owner.attachment,
    colorFormat: owner.format,
    depthFormat: owner.depthFormat,
    edgeDepthTest: owner.edgeDepthTest,
    pointSize: owner.pointSize,
    nodeSize: owner.nodeSize,
    deformation: owner.deformation,
    sectionPlane: owner.sectionPlane,
    resultColors: owner.sectionCaps.resultColors,
    sectionCaps: owner.sectionCaps,
    orbitPivot: owner.orbitPivot,
    originTriadEnabled: owner.originTriadEnabled,
    originTriadNominalScale: owner.originTriadNominalScale,
    timestampRecorder: owner.timestampRecorder,
  });
}

/** Builds the immutable frame input record from current renderer state. */
export function buildFrameOptions(options: FrameOptionSources): FrameOptions {
  const caps = options.sectionCaps.currentFrame;
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
    capCalls: caps?.calls ?? EMPTY_CALLS,
    transparentCapCalls: caps?.transparentCalls ?? EMPTY_CALLS,
    allCapCalls: caps?.allCalls ?? EMPTY_CALLS,
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
