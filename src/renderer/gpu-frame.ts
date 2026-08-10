import { viewProjectionMatrix, type Camera } from "../camera/camera";
import type { Part } from "../geometry/part";
import type { PartId } from "../scene/types";
import type { DeformationState } from "./gpu-deform";
import { writeDeformationUniform } from "./gpu-deform";
import type { DrawCall, DrawCallContext, DrawResources } from "./gpu-draw";
import { drawBatches } from "./gpu-draw";
import type { PickTargets } from "./gpu-pick";
import { ensurePickTargets } from "./gpu-pick";
import { beginPickPass } from "./gpu-pick-pass";
import type { RenderResources } from "./gpu-pipelines";
import { beginColorPass, ensureDepthTexture } from "./gpu-pipelines";
import { drawOrbitPivot } from "./gpu-orbit-pivot";

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
  /** Active world-space camera spin pivot. */
  readonly orbitPivot: readonly [number, number, number] | undefined;
}

/** Encodes and submits one visible color frame without any picking work. */
export function encodeVisibleFrame(
  camera: Camera,
  parts: ReadonlyMap<PartId, Part>,
  frame: FrameOptions,
): void {
  writeFrameUniforms(camera, frame);
  const colorEncoder = frame.device.createCommandEncoder();
  const colorView = frame.context.getCurrentTexture().createView();
  const depthTexture = ensureDepthTexture(
    frame.draw,
    frame.canvas.width,
    frame.canvas.height,
    frame.depthFormat,
  );
  const context = drawContext(frame, parts);
  const colorPass = beginColorPass(colorEncoder, colorView, depthTexture.createView());
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
  drawOrbitPivot(colorPass, frame.resources.orbitPivot, frame.orbitPivot, frame.device);
  colorPass.end();
  frame.device.queue.submit([colorEncoder.finish()]);
}

/** Encodes and submits one current pick snapshot for subsequent readbacks. */
export function encodePickSnapshot(
  camera: Camera,
  parts: ReadonlyMap<PartId, Part>,
  frame: FrameOptions,
): void {
  writeFrameUniforms(camera, frame);
  ensurePickTargets(
    frame.device,
    frame.pickTargets,
    frame.canvas.width,
    frame.canvas.height,
    frame.depthFormat,
  );
  const context = drawContext(frame, parts);
  const pickEncoder = frame.device.createCommandEncoder();
  const pickPass = beginPickPass(pickEncoder, frame.pickTargets);
  drawBatches(pickPass, frame.draw, context, frame.calls, { pass: "pick" });
  pickPass.end();
  frame.device.queue.submit([pickEncoder.finish()]);
}

function drawContext(frame: FrameOptions, parts: ReadonlyMap<PartId, Part>): DrawCallContext {
  return {
    frameBindGroup: frame.resources.frameBindGroup,
    instanceLayout: frame.resources.instanceLayout,
    parts,
    pipelines: frame.resources.pipelines,
  };
}

function writeFrameUniforms(camera: Camera, frame: FrameOptions): void {
  const uniform = new Float32Array(20);
  uniform.set(viewProjectionMatrix(camera), 0);
  uniform[16] = frame.canvas.width;
  uniform[17] = frame.canvas.height;
  uniform[18] = frame.pointSize;
  frame.device.queue.writeBuffer(frame.resources.cameraBuffer, 0, uniform);
  writeDeformationUniform(frame.device, frame.resources.deformationBuffer, frame.deformation);
}

function drawNodeOverlay(
  pass: GPURenderPassEncoder,
  frame: FrameOptions,
  context: DrawCallContext,
): void {
  // Nodes are x-ray annotations; stencil accepts only the first translucent
  // circle at each pixel so overlap cannot darken it.
  pass.setStencilReference(0);
  drawBatches(pass, frame.draw, context, frame.calls, {
    nodes: true,
    pipeline: frame.resources.nodeOverlayPipelines.visible,
  });
}
