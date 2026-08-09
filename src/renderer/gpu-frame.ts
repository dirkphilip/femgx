import { viewProjectionMatrix, type Camera } from "../camera/camera";
import type { Part } from "../geometry/part";
import type { PartId } from "../scene/types";
import type { DeformationState } from "./gpu-deform";
import { writeDeformationUniform } from "./gpu-deform";
import type { DrawCall, DrawCallContext, DrawResources } from "./gpu-draw";
import { drawBatches } from "./gpu-draw";
import type { PickTargets } from "./gpu-pick";
import { beginPickPass, ensurePickTargets } from "./gpu-pick";
import type { RenderResources } from "./gpu-pipelines";
import { beginColorPass, ensureDepthTexture } from "./gpu-pipelines";

/** Everything the per-frame command encoding needs from the renderer. */
export interface FrameOptions {
  readonly canvas: HTMLCanvasElement;
  readonly context: GPUCanvasContext;
  readonly device: GPUDevice;
  readonly draw: DrawResources;
  readonly resources: RenderResources;
  /** Per-part surface draw calls over the visible instances. */
  readonly calls: readonly DrawCall[];
  /** Per-part edge-overlay draw calls over the edge-styled visible instances. */
  readonly edgeCalls: readonly DrawCall[];
  readonly pickTargets: PickTargets;
  readonly depthFormat: GPUTextureFormat;
  /** Whether the edge overlay culls edges occluded by depth (`less`). */
  readonly edgeDepthTest: boolean;
  readonly showNodes: boolean;
  /** Screen-space diameter of point elements in device pixels. */
  readonly pointSize: number;
  /** Per-frame deformation state; `undefined` disables GPU deformation. */
  readonly deformation: DeformationState | undefined;
}

/**
 * Encodes and submits one frame: the visible color pass (with a wireframe edge
 * overlay for the instances whose resolved style requests it) followed by the
 * two-attachment picking pass. The pick targets are always refreshed so
 * `pick(x, y)` reads the ids of the last rendered frame.
 */
export function encodeFrame(
  camera: Camera,
  parts: ReadonlyMap<PartId, Part>,
  frame: FrameOptions,
): void {
  const uniform = new Float32Array(20);
  uniform.set(viewProjectionMatrix(camera), 0);
  uniform[16] = frame.canvas.width;
  uniform[17] = frame.canvas.height;
  uniform[18] = frame.pointSize;
  frame.device.queue.writeBuffer(frame.resources.cameraBuffer, 0, uniform);
  writeDeformationUniform(frame.device, frame.resources.deformationBuffer, frame.deformation);
  const encoder = frame.device.createCommandEncoder();
  const colorView = frame.context.getCurrentTexture().createView();
  const depthTexture = ensureDepthTexture(
    frame.draw,
    frame.canvas.width,
    frame.canvas.height,
    frame.depthFormat,
  );
  const context: DrawCallContext = {
    frameBindGroup: frame.resources.frameBindGroup,
    instanceLayout: frame.resources.instanceLayout,
    parts,
    pipelines: frame.resources.pipelines,
  };
  const colorPass = beginColorPass(encoder, colorView, depthTexture.createView());
  drawBatches(colorPass, frame.draw, context, frame.calls, { pass: "color" });
  if (frame.edgeCalls.length > 0) {
    drawBatches(colorPass, frame.draw, context, frame.edgeCalls, {
      pipeline: frame.edgeDepthTest
        ? frame.resources.edgePipeline
        : frame.resources.edgeAlwaysPipeline,
      overlay: true,
    });
  }
  if (frame.showNodes) drawNodeOverlay(colorPass, frame, context);
  colorPass.end();
  ensurePickTargets(
    frame.device,
    frame.pickTargets,
    frame.canvas.width,
    frame.canvas.height,
    frame.depthFormat,
  );
  const pickPass = beginPickPass(encoder, frame.pickTargets);
  drawBatches(pickPass, frame.draw, context, frame.calls, { pass: "pick" });
  pickPass.end();
  frame.device.queue.submit([encoder.finish()]);
}

function drawNodeOverlay(
  pass: GPURenderPassEncoder,
  frame: FrameOptions,
  context: DrawCallContext,
): void {
  // Depth keeps rear nodes behind the model; stencil accepts only the first
  // visible translucent circle at each pixel so overlap cannot darken it.
  pass.setStencilReference(0);
  drawBatches(pass, frame.draw, context, frame.calls, {
    nodes: true,
    pipeline: frame.resources.nodeOverlayPipelines.visible,
  });
}
