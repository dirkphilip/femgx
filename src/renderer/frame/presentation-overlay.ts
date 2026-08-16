import type { DrawCall, DrawCallContext, DrawResources } from "../resources/draw-resources";
import type { ReadyColorTargets } from "../resources/color-targets";
import { drawBatches } from "./batch";
import { beginOverlayDepthPass, beginOverlayPass } from "./passes";
import { ensureOverlayDepthBindGroup, type RenderResources } from "./pipelines";
import type { GpuTimestampFrame } from "../diagnostics/timestamps";
import { popDebugGroup, pushDebugGroup } from "./debug";

interface PresentationFrame {
  readonly draw: DrawResources;
  readonly resources: RenderResources;
  readonly edgeCalls: readonly DrawCall[];
  readonly nodeCalls: readonly DrawCall[];
  readonly edgeDepthTest: boolean;
}

interface PresentationOverlayOptions {
  readonly encoder: GPUCommandEncoder;
  readonly frame: PresentationFrame;
  readonly context: DrawCallContext;
  readonly targets: ReadyColorTargets;
  readonly swapChainView: GPUTextureView;
  readonly timestampFrame: GpuTimestampFrame | undefined;
}

/** Returns whether native edges require the opt-in resolved presentation path. */
export function needsResolvedOverlay(frame: PresentationFrame): boolean {
  return frame.edgeCalls.length > 0;
}

/** Resolves opaque depth once, then draws exact-topology presentation at 1x. */
export function drawPresentationOverlayPass(options: PresentationOverlayOptions): void {
  const { encoder, frame, context, targets, swapChainView, timestampFrame } = options;
  if (targets.overlayDepth === undefined) {
    throw new Error("Presentation overlay depth target is unavailable");
  }
  const overlayDepthView = targets.overlayDepth.createView({ label: "femgx overlay depth view" });
  const depthPass = beginOverlayDepthPass(
    encoder,
    overlayDepthView,
    timestampFrame?.writes("overlay-depth"),
  );
  pushDebugGroup(depthPass, "overlay depth");
  frame.draw.cost.pass("overlay-depth");
  depthPass.setPipeline(frame.resources.overlayDepth.pipeline);
  depthPass.setBindGroup(0, ensureOverlayDepthBindGroup(frame.draw, frame.resources));
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
  pushDebugGroup(pass, "edges and nodes");
  frame.draw.cost.pass("overlay");
  if (frame.edgeCalls.length > 0) {
    pushDebugGroup(pass, "edges");
    drawBatches(pass, frame.draw, context, frame.edgeCalls, {
      kind: "edge",
      pipeline: frame.edgeDepthTest
        ? frame.resources.edgePipeline
        : frame.resources.edgeAlwaysPipeline,
    });
    popDebugGroup(pass);
  }
  if (frame.nodeCalls.length > 0) {
    pushDebugGroup(pass, "nodes");
    drawBatches(pass, frame.draw, context, frame.nodeCalls, {
      kind: "nodes",
      pipeline: frame.resources.nodeOverlayPipelines.resolved,
    });
    popDebugGroup(pass);
  }
  popDebugGroup(pass);
  pass.end();
}
