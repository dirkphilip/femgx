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
import { beginColorPass, beginCompositePass, beginTransparencyPass } from "./gpu-passes";
import type { RenderResources } from "./gpu-pipelines";
import { ensureColorTargets, ensureCompositeBindGroup } from "./gpu-pipelines";
import { drawOriginTriad, originTriadScale, writeOriginTriad } from "./gpu-origin-triad";
import { drawOrbitPivot, writeOrbitPivot } from "./gpu-orbit-pivot";

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
  /** Per-part selected-instance calls for the depth-aware x-ray selection pass. */
  readonly selectionCalls: readonly DrawCall[];
  /** Per-part selected-node-instance calls for the exact node glyph pass. */
  readonly selectedNodeCalls: readonly DrawCall[];
  readonly pickTargets: PickTargets;
  readonly depthFormat: GPUTextureFormat;
  /** Whether the edge overlay culls edges occluded by depth (`less`). */
  readonly edgeDepthTest: boolean;
  /** Screen-space diameter of point elements in CSS pixels. */
  readonly pointSize: number;
  /** Screen-space diameter of FE node annotations in CSS pixels. */
  readonly nodeSize: number;
  /** Per-frame deformation state; `undefined` disables GPU deformation. */
  readonly deformation: DeformationState | undefined;
  /** Per-part nodal scalar colors, or `undefined` when result coloring is off. */
  readonly resultColors: ReadonlyMap<PartId, Float32Array> | undefined;
  /** Active world-space camera spin pivot. */
  readonly orbitPivot: readonly [number, number, number] | undefined;
  /** Whether the construction-time world-origin triad is enabled. */
  readonly originTriadEnabled: boolean;
  /** Stable bounds-derived world scale before the per-camera cap. */
  readonly originTriadNominalScale: number;
  /** Current display density used by fixed-size presentation helpers. */
  readonly devicePixelRatio: number;
}

/** Converts a CSS-pixel point diameter into device pixels for the GPU uniform. */
export function pointSizeDevicePixels(cssPixels: number, dpr = devicePixelRatio): number {
  return Math.max(1, cssPixels * dpr);
}

/** Converts a CSS-pixel node diameter into device pixels for the GPU uniform. */
export function nodeSizeDevicePixels(cssPixels: number, dpr = devicePixelRatio): number {
  return Math.max(1, cssPixels * dpr);
}

/** Returns the world-space key direction for a fixed upper-left camera-space light. */
export function cameraKeyLightDirection(camera: Camera): Vec3 {
  const forward = normalize(subtract(camera.target, camera.position));
  const right = normalize(cross(forward, camera.up));
  const up = cross(right, forward);
  return normalize(add(add(scale(right, -0.5), scale(up, 1)), scale(forward, -0.4)));
}

/** Returns the normalized world-space direction from the camera toward the scene. */
export function cameraViewDirection(camera: Camera): Vec3 {
  return normalize(subtract(camera.position, camera.target));
}

/** Encodes and submits one visible color frame without any picking work. */
export function encodeVisibleFrame(
  camera: Camera,
  parts: ReadonlyMap<PartId, Part>,
  frame: FrameOptions,
): void {
  writeFrameUniforms(camera, frame);
  if (frame.originTriadEnabled && frame.resources.originTriad !== undefined) {
    writeOriginTriad(
      frame.device,
      frame.resources.originTriad,
      originTriadScale(camera, frame.originTriadNominalScale),
    );
    frame.draw.cost.write("uniform", 32);
  }
  const orbitPivotActive = writeOrbitPivot(frame.device, frame.resources.orbitPivot, {
    point: frame.orbitPivot,
    camera,
    devicePixelRatio: frame.devicePixelRatio,
  });
  if (orbitPivotActive) frame.draw.cost.write("uniform", 56);
  const colorEncoder = frame.device.createCommandEncoder();
  const targets = ensureColorTargets(
    frame.draw,
    frame.canvas.width,
    frame.canvas.height,
    frame.colorFormat,
    frame.depthFormat,
  );
  frame.draw.cost.targets(frame.canvas.width, frame.canvas.height, frame.devicePixelRatio);
  const context = drawContext(frame, parts);
  frame.draw.cost.pass("opaque");
  const opaquePass = beginColorPass(
    colorEncoder,
    targets.color.createView(),
    targets.depth.createView(),
    targets.opaqueColor.createView(),
  );
  opaquePass.setPipeline(frame.resources.background.pipeline);
  opaquePass.setBindGroup(0, frame.resources.frameBindGroup);
  opaquePass.setBindGroup(1, frame.resources.background.bindGroup);
  opaquePass.draw(3);
  frame.draw.cost.draw("background", 3);
  drawBatches(opaquePass, frame.draw, context, frame.calls, { kind: "surface", pass: "color" });
  if (frame.originTriadEnabled && frame.resources.originTriad !== undefined) {
    drawOriginTriad(opaquePass, frame.resources.originTriad, "visible");
    frame.draw.cost.draw("origin-triad", 45);
  }
  drawBatches(opaquePass, frame.draw, context, frame.calls, {
    kind: "surface",
    pass: "color",
    primitive: "points",
  });
  drawSelectionPass(opaquePass, frame, context, "selection-visible");
  if (orbitPivotActive) drawOrbitPivot(opaquePass, frame.resources.orbitPivot, "visible");
  if (orbitPivotActive) frame.draw.cost.draw("pivot", 60);
  opaquePass.end();
  drawTransparencyPass(colorEncoder, frame, context, targets, orbitPivotActive);
  drawCompositePass(colorEncoder, frame, context, targets);
  frame.device.queue.submit([colorEncoder.finish()]);
}

function drawTransparencyPass(
  encoder: GPUCommandEncoder,
  frame: FrameOptions,
  context: DrawCallContext,
  targets: ReturnType<typeof ensureColorTargets>,
  orbitPivotActive: boolean,
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
  frame.draw.cost.pass("transparency");
  if (frame.transparentCalls.length > 0) {
    drawBatches(pass, frame.draw, context, frame.transparentCalls, {
      kind: "surface",
      pass: "transparent",
    });
  }
  drawSelectionPass(pass, frame, context, "selection-hidden");
  if (frame.originTriadEnabled && frame.resources.originTriad !== undefined) {
    drawOriginTriad(pass, frame.resources.originTriad, "hidden");
    frame.draw.cost.draw("origin-triad", 45);
  }
  if (orbitPivotActive) drawOrbitPivot(pass, frame.resources.orbitPivot, "hidden");
  if (orbitPivotActive) frame.draw.cost.draw("pivot", 60);
  pass.end();
}

function drawSelectionPass(
  pass: GPURenderPassEncoder,
  frame: FrameOptions,
  context: DrawCallContext,
  variant: "selection-visible" | "selection-hidden",
): void {
  if (frame.selectionCalls.length > 0) {
    drawBatches(pass, frame.draw, context, frame.selectionCalls, {
      kind: "surface",
      pass: variant,
    });
  }
  if (frame.selectedNodeCalls.length > 0) {
    drawBatches(pass, frame.draw, context, frame.selectedNodeCalls, {
      kind: "nodes",
      pipeline:
        variant === "selection-visible"
          ? frame.resources.pipelines.nodesSelectionVisible
          : frame.resources.pipelines.nodesSelectionHidden,
      selection: variant === "selection-visible" ? "visible" : "hidden",
    });
  }
}

function drawCompositePass(
  encoder: GPUCommandEncoder,
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
  frame.draw.cost.pass("composite");
  pass.setPipeline(frame.resources.composite.pipeline);
  pass.setBindGroup(0, ensureCompositeBindGroup(frame.draw, frame.resources));
  pass.draw(3);
  frame.draw.cost.draw("composite", 3);
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
  frame.draw.cost.pass("pick");
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
    resultColors: frame.resultColors,
  };
}

function writeFrameUniforms(camera: Camera, frame: FrameOptions): void {
  const uniform = new Float32Array(32);
  uniform.set(viewProjectionMatrix(camera), 0);
  uniform[16] = frame.canvas.width;
  uniform[17] = frame.canvas.height;
  uniform[18] = pointSizeDevicePixels(frame.pointSize, frame.devicePixelRatio);
  uniform[19] = nodeSizeDevicePixels(frame.nodeSize, frame.devicePixelRatio);
  uniform[20] = frame.devicePixelRatio;
  uniform[21] = 8;
  uniform[22] = 0;
  uniform.set(cameraKeyLightDirection(camera), 24);
  uniform.set(cameraViewDirection(camera), 28);
  frame.device.queue.writeBuffer(frame.resources.cameraBuffer, 0, uniform);
  frame.draw.cost.write("uniform", uniform.byteLength);
  writeDeformationUniform(
    frame.device,
    frame.resources.deformationBuffer,
    frame.deformation,
    frame.draw.cost,
  );
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
