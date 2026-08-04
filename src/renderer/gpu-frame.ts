import { viewProjectionMatrix, type Camera } from "../camera/camera";
import type { Part } from "../geometry/part";
import type { PartId } from "../scene/types";
import type { DrawCall, DrawCallContext, DrawResources } from "./gpu-draw";
import { drawBatches } from "./gpu-draw";
import type { PickTargets } from "./gpu-pick";
import { beginPickPass, ensurePickTargets } from "./gpu-pick";
import type { RenderResources } from "./gpu-pipelines";
import { beginColorPass, ensureDepthTexture } from "./gpu-pipelines";

/** How the visible color pass renders each part. */
export type DisplayMode = "solid" | "edge";

/** Everything the per-frame command encoding needs from the renderer. */
export interface FrameOptions {
  readonly canvas: HTMLCanvasElement;
  readonly context: GPUCanvasContext;
  readonly device: GPUDevice;
  readonly draw: DrawResources;
  readonly resources: RenderResources;
  readonly calls: readonly DrawCall[];
  readonly pickTargets: PickTargets;
  readonly depthFormat: GPUTextureFormat;
  readonly displayMode: DisplayMode;
  /** Screen-space diameter of point elements in device pixels. */
  readonly pointSize: number;
}

/**
 * Encodes and submits one frame: the visible color pass (optionally with the
 * wireframe edge overlay in edge display mode) followed by the two-attachment
 * picking pass. The pick targets are always refreshed so `pick(x, y)` reads the
 * ids of the last rendered frame.
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
  const encoder = frame.device.createCommandEncoder();
  const colorView = frame.context.getCurrentTexture().createView();
  const depthTexture = ensureDepthTexture(
    frame.draw,
    frame.canvas.width,
    frame.canvas.height,
    frame.depthFormat,
  );
  const context: DrawCallContext = {
    cameraBindGroup: frame.resources.cameraBindGroup,
    instanceLayout: frame.resources.instanceLayout,
    parts,
    pipelines: frame.resources.pipelines,
  };
  const colorPass = beginColorPass(encoder, colorView, depthTexture.createView());
  drawBatches(colorPass, frame.draw, context, frame.calls, { pass: "color" });
  if (frame.displayMode === "edge") {
    drawBatches(colorPass, frame.draw, context, frame.calls, {
      pipeline: frame.resources.edgePipeline,
      index: "edges",
    });
  }
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
