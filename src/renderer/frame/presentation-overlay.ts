import type { DrawCall, DrawCallContext, DrawResources } from "../resources/draw-resources";
import type { ReadyColorTargets } from "../resources/color-targets";
import { drawBatches } from "./batch";
import { beginOverlayDepthPass, beginOverlayPass } from "./passes";
import { ensureOverlayDepthBindGroup, type RenderResources } from "./pipelines";

interface PresentationFrame {
  readonly draw: DrawResources;
  readonly resources: RenderResources;
  readonly edgeCalls: readonly DrawCall[];
  readonly nodeCalls: readonly DrawCall[];
  readonly edgeDepthTest: boolean;
}

/** Returns whether native edges require the opt-in resolved presentation path. */
export function needsResolvedOverlay(frame: PresentationFrame): boolean {
  return frame.edgeCalls.length > 0;
}

/** Resolves opaque depth once, then draws exact-topology presentation at 1x. */
export function drawPresentationOverlayPass(
  encoder: GPUCommandEncoder,
  frame: PresentationFrame,
  context: DrawCallContext,
  targets: ReadyColorTargets,
  swapChainView: GPUTextureView,
): void {
  if (targets.overlayDepth === undefined) {
    throw new Error("Presentation overlay depth target is unavailable");
  }
  const overlayDepthView = targets.overlayDepth.createView();
  const depthPass = beginOverlayDepthPass(encoder, overlayDepthView);
  frame.draw.cost.pass("overlay-depth");
  depthPass.setPipeline(frame.resources.overlayDepth.pipeline);
  depthPass.setBindGroup(0, ensureOverlayDepthBindGroup(frame.draw, frame.resources));
  depthPass.draw(3);
  frame.draw.cost.draw("overlay-depth", 3);
  depthPass.end();

  const pass = beginOverlayPass(encoder, swapChainView, overlayDepthView);
  frame.draw.cost.pass("overlay");
  if (frame.edgeCalls.length > 0) {
    drawBatches(pass, frame.draw, context, frame.edgeCalls, {
      kind: "edge",
      pipeline: frame.edgeDepthTest
        ? frame.resources.edgePipeline
        : frame.resources.edgeAlwaysPipeline,
    });
  }
  if (frame.nodeCalls.length > 0) {
    drawBatches(pass, frame.draw, context, frame.nodeCalls, {
      kind: "nodes",
      pipeline: frame.resources.nodeOverlayPipelines.resolved,
    });
  }
  pass.end();
}
