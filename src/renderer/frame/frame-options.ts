import type { SectionPlane } from "../../math/section-plane";
import type { DeformationState } from "../../results/deform";
import type { PartId } from "../../geometry/part";
import type { GpuBundle } from "../recovery";
import type { FrameOptions } from "./frame";

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
  readonly colorFormat: GPUTextureFormat;
  readonly depthFormat: GPUTextureFormat;
  readonly edgeDepthTest: boolean;
  readonly pointSize: number;
  readonly nodeSize: number;
  readonly deformation: DeformationState | undefined;
  readonly sectionPlane: SectionPlane | undefined;
  readonly resultColors: ReadonlyMap<PartId, Float32Array> | undefined;
  readonly orbitPivot: readonly [number, number, number] | undefined;
  readonly originTriadEnabled: boolean;
  readonly originTriadNominalScale: number;
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
    devicePixelRatio,
  };
}
