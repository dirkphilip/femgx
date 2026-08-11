import { viewProjectionMatrix, type Camera } from "../camera/camera";
import type { Part } from "../geometry/part";
import type { PartId } from "../geometry/part";
import type { DeformationState } from "../results/deform";
import { writeDeformationUniform } from "./gpu-deform";
import type { DrawCall, DrawCallContext, DrawResources } from "./gpu-draw";
import { drawBatches } from "./gpu-draw";
import type { PickTargets } from "./gpu-pick";
import { ensurePickTargets } from "./gpu-pick";
import { beginPickPass } from "./gpu-pick-pass";
import type { RenderResources } from "./gpu-pipelines";
import { beginColorPass, ensureColorTargets } from "./gpu-pipelines";
import { drawOrbitPivot } from "./gpu-orbit-pivot";

/** Everything the per-frame command encoding needs from the renderer. */
export interface FrameOptions {
  readonly canvas: HTMLCanvasElement;
  readonly context: GPUCanvasContext;
  readonly device: GPUDevice;
  readonly draw: DrawResources;
  readonly resources: RenderResources;
  /** Swap-chain / MSAA color format matching the configured canvas context. */
  readonly colorFormat: GPUTextureFormat;
  /** Per-part surface draw calls over the visible instances. */
  readonly calls: readonly DrawCall[];
  /** Per-part edge-overlay draw calls over the edge-styled visible instances. */
  readonly edgeCalls: readonly DrawCall[];
  readonly pickTargets: PickTargets;
  readonly depthFormat: GPUTextureFormat;
  /** Whether the edge overlay culls edges occluded by depth (`less`). */
  readonly edgeDepthTest: boolean;
  readonly showNodes: boolean;
  /**
   * Screen-space diameter of point elements in CSS pixels; node annotations use
   * three-quarters. Written to the camera uniform as device pixels
   * (`× devicePixelRatio`).
   */
  readonly pointSize: number;
  /** Per-frame deformation state; `undefined` disables GPU deformation. */
  readonly deformation: DeformationState | undefined;
  /** Active world-space camera spin pivot. */
  readonly orbitPivot: readonly [number, number, number] | undefined;
}

/** Converts a CSS-pixel point diameter into device pixels for the GPU uniform. */
export function pointSizeDevicePixels(cssPixels: number, dpr = devicePixelRatio): number {
  return Math.max(1, cssPixels * dpr);
}

/** Encodes and submits one visible color frame without any picking work. */
export function encodeVisibleFrame(
  camera: Camera,
  parts: ReadonlyMap<PartId, Part>,
  frame: FrameOptions,
): void {
  writeFrameUniforms(camera, frame);
  const colorEncoder = frame.device.createCommandEncoder();
  const resolveTarget = frame.context.getCurrentTexture().createView();
  const targets = ensureColorTargets(
    frame.draw,
    frame.canvas.width,
    frame.canvas.height,
    frame.colorFormat,
    frame.depthFormat,
  );
  const context = drawContext(frame, parts);
  const colorView = targets.color.createView();
  const depthView = targets.depth.createView();
  const colorPass = beginColorPass(colorEncoder, colorView, depthView, resolveTarget);
  drawBatches(colorPass, frame.draw, context, frame.calls, { pass: "color" });
  if (frame.edgeCalls.length > 0) {
    drawBatches(colorPass, frame.draw, context, frame.edgeCalls, {
      pipeline: frame.edgeDepthTest
        ? frame.resources.edgePipeline
        : frame.resources.edgeAlwaysPipeline,
      overlay: true,
    });
  }
  if (frame.showNodes) {
    drawNodeOverlay(colorPass, frame, context);
  }
  drawFrameOrbitPivot(colorPass, camera, frame);
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
  const uniform = new Float32Array(24);
  uniform.set(viewProjectionMatrix(camera), 0);
  uniform[16] = frame.canvas.width;
  uniform[17] = frame.canvas.height;
  uniform[18] = pointSizeDevicePixels(frame.pointSize);
  uniform[19] = camera.near;
  uniform[20] = camera.far;
  uniform[21] = camera.mode === "orthographic" ? 1 : 0;
  uniform[22] = 0;
  frame.device.queue.writeBuffer(frame.resources.cameraBuffer, 0, uniform);
  writeDeformationUniform(frame.device, frame.resources.deformationBuffer, frame.deformation);
}

function drawNodeOverlay(
  pass: GPURenderPassEncoder,
  frame: FrameOptions,
  context: DrawCallContext,
): void {
  drawBatches(pass, frame.draw, context, frame.calls, {
    nodes: true,
    pipeline: frame.resources.nodeOverlayPipelines.visible,
  });
}

/** Draws the temporary camera-pivot widget in whichever overlay pass is active. */
function drawFrameOrbitPivot(
  pass: GPURenderPassEncoder,
  camera: Camera,
  frame: FrameOptions,
): void {
  drawOrbitPivot(
    pass,
    frame.resources.orbitPivot,
    {
      point: frame.orbitPivot,
      camera,
      pointSizeDevicePixels: pointSizeDevicePixels(frame.pointSize),
    },
    frame.device,
  );
}
