import type { GpuTimestampFrame } from "../diagnostics/timestamps";
import type { Part, PartId } from "../../geometry/part";
import type { DrawCall, DrawCallContext, DrawResources } from "../resources/draw-resources";
import type { ReadyColorTargets } from "../resources/color-targets";
import { drawBatches } from "./batch";
import { popDebugGroup, pushDebugGroup } from "./debug";
import { ensureResolvedNodeOverlayPipeline } from "../shaders/node-overlay";
import { beginOverlayDepthPass, beginOverlayPass } from "./passes";
import { ensureOverlayDepthBindGroup, ensureOverlayDepthResources } from "./overlay-depth";
import type { RenderResources } from "./pipelines";

interface PresentationFrame {
  readonly draw: DrawResources;
  readonly resources: RenderResources;
  readonly edgeCalls: readonly DrawCall[];
  readonly nodeCalls: readonly DrawCall[];
  readonly edgeDepthTest: boolean;
  readonly depthFormat: GPUTextureFormat;
  readonly colorFormat: GPUTextureFormat;
}

interface PresentationOverlayOptions {
  readonly encoder: GPUCommandEncoder;
  readonly frame: PresentationFrame;
  readonly context: DrawCallContext;
  readonly targets: ReadyColorTargets;
  readonly swapChainView: GPUTextureView;
  readonly timestampFrame: GpuTimestampFrame | undefined;
}

/** Native lines need the resolved depth contract only while authored edge presentation is active. */
export function needsResolvedOverlay(
  frame: PresentationFrame,
  parts: ReadonlyMap<PartId, Part>,
): boolean {
  return (
    frame.edgeDepthTest &&
    frame.edgeCalls.some((call) => hasRenderableNativeEdges(parts.get(call.partId)))
  );
}

function hasRenderableNativeEdges(part: Part | undefined): boolean {
  return (
    part?.geometries.some(
      (geometry) =>
        geometry.primitive === "triangles" &&
        (geometry.presentationEdges === undefined
          ? geometry.indices.length >= 3
          : geometry.presentationEdges.length >= 2),
    ) === true
  );
}

/** Resolves conservative visible depth, then presents compact native edges at one sample. */
export function drawPresentationOverlayPass(options: PresentationOverlayOptions): void {
  const { encoder, frame, context, targets, swapChainView, timestampFrame } = options;
  if (targets.overlayDepth === undefined)
    throw new Error("Presentation overlay depth target is unavailable");
  const resources = ensureOverlayDepthResources(frame.draw, frame.depthFormat);
  const overlayDepthView = targets.overlayDepth.createView({ label: "femgx overlay depth view" });
  const depthPass = beginOverlayDepthPass(
    encoder,
    overlayDepthView,
    timestampFrame?.writes("overlay-depth"),
  );
  pushDebugGroup(depthPass, "overlay depth");
  frame.draw.cost.pass("overlay-depth");
  depthPass.setPipeline(resources.pipeline);
  depthPass.setBindGroup(0, ensureOverlayDepthBindGroup(frame.draw, resources));
  depthPass.draw(3);
  frame.draw.cost.draw("overlay-depth", 3);
  popDebugGroup(depthPass);
  depthPass.end();

  const pass = beginOverlayPass(
    encoder,
    swapChainView,
    overlayDepthView,
    timestampFrame?.writes("overlay"),
  );
  pushDebugGroup(pass, "edges");
  frame.draw.cost.pass("overlay");
  drawBatches(pass, frame.draw, context, frame.edgeCalls, {
    kind: "edge",
    pipeline: frame.resources.edgePipeline,
  });
  popDebugGroup(pass);
  if (frame.nodeCalls.length > 0) {
    pushDebugGroup(pass, "nodes");
    drawBatches(pass, frame.draw, context, frame.nodeCalls, {
      kind: "nodes",
      pipeline: ensureResolvedNodeOverlayPipeline(
        frame.draw.device,
        frame.resources.pipelineLayout,
        frame.resources.nodeOverlayPipelines,
        frame.colorFormat,
        frame.depthFormat,
      ),
    });
    popDebugGroup(pass);
  }
  pass.end();
}
