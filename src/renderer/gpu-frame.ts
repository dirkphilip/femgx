import { viewProjectionMatrix, type Camera } from "../camera/camera";
import type { Part } from "../geometry/part";
import type { PartId } from "../geometry/part";
import { add, cross, normalize, scale, subtract, type Vec3 } from "../math/vec3";
import type { DeformationState } from "../results/deform";
import { writeDeformationUniform } from "./gpu-deform";
import type { DrawCall, DrawCallContext, DrawResources } from "./gpu-draw";
import { drawBatches } from "./gpu-batch";
import type { PickTargets } from "./gpu-pick";
import { ensurePickTargets } from "./gpu-pick";
import { beginPickPass } from "./gpu-pick-pass";
import type { RenderResources } from "./gpu-pipelines";
import {
  beginColorPass,
  beginCompositePass,
  beginTransparencyPass,
  ensureColorTargets,
  ensureCompositeBindGroup,
} from "./gpu-pipelines";
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
  /** Per-part calls containing instances with at least one transparent fragment. */
  readonly transparentCalls: readonly DrawCall[];
  /** Per-part edge-overlay draw calls over the edge-styled visible instances. */
  readonly edgeCalls: readonly DrawCall[];
  /** Per-part node-annotation draw calls over the node-styled visible instances. */
  readonly nodeCalls: readonly DrawCall[];
  readonly pickTargets: PickTargets;
  readonly depthFormat: GPUTextureFormat;
  /** Whether the edge overlay culls edges occluded by depth (`less`). */
  readonly edgeDepthTest: boolean;
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

/** Returns the world-space key direction for a fixed upper-left camera-space light. */
export function cameraKeyLightDirection(camera: Camera): Vec3 {
  const forward = normalize(subtract(camera.target, camera.position));
  const right = normalize(cross(forward, camera.up));
  const up = cross(right, forward);
  return normalize(add(add(scale(right, -0.45), scale(up, 0.55)), scale(forward, -1)));
}

/** Encodes and submits one visible color frame without any picking work. */
export function encodeVisibleFrame(
  camera: Camera,
  parts: ReadonlyMap<PartId, Part>,
  frame: FrameOptions,
): void {
  writeFrameUniforms(camera, frame);
  const colorEncoder = frame.device.createCommandEncoder();
  const targets = ensureColorTargets(
    frame.draw,
    frame.canvas.width,
    frame.canvas.height,
    frame.colorFormat,
    frame.depthFormat,
  );
  const context = drawContext(frame, parts);
  const opaquePass = beginColorPass(
    colorEncoder,
    targets.color.createView(),
    targets.depth.createView(),
    targets.opaqueColor.createView(),
  );
  drawBatches(opaquePass, frame.draw, context, frame.calls, { kind: "surface", pass: "color" });
  opaquePass.end();
  drawTransparencyPass(colorEncoder, frame, context, targets);
  drawCompositePass(colorEncoder, camera, frame, context, targets);
  frame.device.queue.submit([colorEncoder.finish()]);
}

function drawTransparencyPass(
  encoder: GPUCommandEncoder,
  frame: FrameOptions,
  context: DrawCallContext,
  targets: ReturnType<typeof ensureColorTargets>,
): void {
  const pass = beginTransparencyPass(
    encoder,
    {
      accumulationView: targets.msaaAccumulation.createView(),
      accumulationResolve: targets.accumulation.createView(),
      revealageView: targets.msaaRevealage.createView(),
      revealageResolve: targets.revealage.createView(),
    },
    targets.depth.createView(),
  );
  if (frame.transparentCalls.length > 0) {
    drawBatches(pass, frame.draw, context, frame.transparentCalls, {
      kind: "surface",
      pass: "transparent",
    });
  }
  pass.end();
}

function drawCompositePass(
  encoder: GPUCommandEncoder,
  camera: Camera,
  frame: FrameOptions,
  context: DrawCallContext,
  targets: ReturnType<typeof ensureColorTargets>,
): void {
  const pass = beginCompositePass(
    encoder,
    targets.color.createView(),
    frame.context.getCurrentTexture().createView(),
    targets.depth.createView(),
  );
  pass.setPipeline(frame.resources.composite.pipeline);
  pass.setBindGroup(0, ensureCompositeBindGroup(frame.draw, frame.resources));
  pass.draw(3);
  if (frame.edgeCalls.length > 0) {
    drawBatches(pass, frame.draw, context, frame.edgeCalls, {
      kind: "edge",
      pipeline: frame.edgeDepthTest
        ? frame.resources.edgePipeline
        : frame.resources.edgeAlwaysPipeline,
    });
  }
  if (frame.nodeCalls.length > 0) {
    drawNodeOverlay(pass, frame, context);
  }
  drawFrameOrbitPivot(pass, camera, frame);
  pass.end();
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
  drawBatches(pickPass, frame.draw, context, frame.calls, { kind: "surface", pass: "pick" });
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
  const uniform = new Float32Array(28);
  uniform.set(viewProjectionMatrix(camera), 0);
  uniform[16] = frame.canvas.width;
  uniform[17] = frame.canvas.height;
  uniform[18] = pointSizeDevicePixels(frame.pointSize);
  uniform[19] = camera.near;
  uniform[20] = camera.far;
  uniform[21] = camera.mode === "orthographic" ? 1 : 0;
  uniform[22] = 0;
  uniform.set(cameraKeyLightDirection(camera), 24);
  frame.device.queue.writeBuffer(frame.resources.cameraBuffer, 0, uniform);
  writeDeformationUniform(frame.device, frame.resources.deformationBuffer, frame.deformation);
}

function drawNodeOverlay(
  pass: GPURenderPassEncoder,
  frame: FrameOptions,
  context: DrawCallContext,
): void {
  drawBatches(pass, frame.draw, context, frame.nodeCalls, {
    kind: "nodes",
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
