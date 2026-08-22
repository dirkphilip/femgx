import type { Camera } from "../../camera/camera";
import type { Part } from "../../geometry/part";
import type { PartId } from "../../geometry/part";
import type { DrawCallContext } from "../resources/draw-resources";
import { drawBatches } from "./batch";
import { drawOrientationGlyphs } from "../orientation-glyphs/draw";
import { ensurePickTargets } from "../picking/pick";
import { beginPickPass } from "../picking/pass";
import { beginColorPass, beginCompositePass, beginTransparencyPass } from "../frame/passes";
import { ensureColorTargets, ensureCompositeBindGroup } from "./pipelines";
import type { ReadyColorTargets } from "../resources/color-targets";
import { drawOriginTriad, originTriadScale, writeOriginTriad } from "../overlays/origin-triad";
import { drawOrbitPivot, writeOrbitPivot } from "../overlays/orbit-pivot";
import { drawPresentationOverlayPass, needsResolvedOverlay } from "./presentation-overlay";
import { drawSectionCaps } from "./section-cap-draw";
import { writeFrameUniforms } from "./frame-uniforms";
import type { GpuTimestampFrame } from "../diagnostics/timestamps";
import { popDebugGroup, pushDebugGroup } from "./debug";
import type { FrameOptions } from "./frame-types";
import {
  drawAuthoredPrimitiveGroups,
  drawContext,
  drawSectionCapContext,
  drawNodeOverlay,
  drawSelectionPass,
} from "./draw-groups";
import { requireWeightedTargets, type WeightedColorTargets } from "./weighted-targets";

export { cameraKeyLightDirection, cameraViewDirection, writeFrameUniforms } from "./frame-uniforms";
export { nodeSizeDevicePixels, pointSizeDevicePixels } from "./sizes";
export { AUTHORED_PRIMITIVE_PRECEDENCE } from "./draw-groups";
export { drawContext } from "./draw-groups";
export type { FrameOptions } from "./frame-types";

/** Returns whether this frame has any producer that requires weighted targets. */
export function needsWeightedTransparency(
  frame: {
    readonly transparentCalls: readonly unknown[];
    readonly transparentCapCalls?: readonly unknown[];
    readonly selectionCalls: readonly unknown[];
    readonly selectedNodeCalls: readonly unknown[];
    readonly originTriadEnabled: boolean;
    readonly originTriadAvailable: boolean;
  },
  orbitPivotActive: boolean,
): boolean {
  return (
    frame.transparentCalls.length > 0 ||
    (frame.transparentCapCalls?.length ?? 0) > 0 ||
    frame.selectionCalls.length > 0 ||
    frame.selectedNodeCalls.length > 0 ||
    (frame.originTriadEnabled && frame.originTriadAvailable) ||
    orbitPivotActive
  );
}

interface VisibleFrameSetup {
  readonly colorEncoder: GPUCommandEncoder;
  readonly context: DrawCallContext;
  readonly targets: ReadyColorTargets;
  readonly swapChainView: GPUTextureView;
  readonly needsTransparency: boolean;
  readonly resolvedOverlay: boolean;
  readonly orbitPivotActive: boolean;
}

function prepareVisibleFrame(
  camera: Camera,
  parts: ReadonlyMap<PartId, Part>,
  frame: FrameOptions,
): VisibleFrameSetup {
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
  const needsTransparency = needsWeightedTransparency(
    {
      transparentCalls: frame.transparentCalls,
      ...(frame.transparentCapCalls === undefined
        ? {}
        : { transparentCapCalls: frame.transparentCapCalls }),
      selectionCalls: frame.selectionCalls,
      selectedNodeCalls: frame.selectedNodeCalls,
      originTriadEnabled: frame.originTriadEnabled,
      originTriadAvailable: frame.resources.originTriad !== undefined,
    },
    orbitPivotActive,
  );
  const resolvedOverlay = needsResolvedOverlay(frame, parts);
  const targets = ensureColorTargets(frame.draw, {
    width: frame.canvas.width,
    height: frame.canvas.height,
    colorFormat: frame.colorFormat,
    depthFormat: frame.depthFormat,
    requiresTransparency: needsTransparency,
    requiresOverlays: resolvedOverlay,
  });
  frame.draw.cost.targets(
    frame.canvas.width,
    frame.canvas.height,
    frame.devicePixelRatio,
    needsTransparency,
    resolvedOverlay,
  );
  return {
    colorEncoder: frame.device.createCommandEncoder({ label: "femgx visible frame" }),
    context: drawContext(frame, parts),
    targets,
    swapChainView: frame.context.getCurrentTexture().createView({ label: "femgx swapchain view" }),
    needsTransparency,
    resolvedOverlay,
    orbitPivotActive,
  };
}

/** Encodes and submits one visible color frame without any picking work. */
export function encodeVisibleFrame(
  camera: Camera,
  parts: ReadonlyMap<PartId, Part>,
  frame: FrameOptions,
): void {
  const timestampFrame = frame.timestampRecorder?.beginFrame();
  const {
    colorEncoder,
    context,
    targets,
    swapChainView,
    needsTransparency,
    resolvedOverlay,
    orbitPivotActive,
  } = prepareVisibleFrame(camera, parts, frame);
  drawOpaquePass({
    colorEncoder,
    context,
    frame,
    needsTransparency,
    resolvedOverlay,
    orbitPivotActive,
    swapChainView,
    targets,
    timestampFrame,
  });
  if (needsTransparency) {
    const weightedTargets = requireWeightedTargets(targets);
    drawTransparencyPass({
      encoder: colorEncoder,
      frame,
      context,
      targets: weightedTargets,
      orbitPivotActive,
      timestampFrame,
    });
    drawCompositePass({
      encoder: colorEncoder,
      frame,
      context,
      resolvedOverlay,
      targets: weightedTargets,
      swapChainView,
      timestampFrame,
    });
  }
  if (resolvedOverlay) {
    drawPresentationOverlayPass({
      encoder: colorEncoder,
      frame,
      context,
      targets,
      swapChainView,
      timestampFrame,
    });
  }
  if (timestampFrame !== undefined) frame.timestampRecorder?.resolve(colorEncoder, timestampFrame);
  frame.device.queue.submit([colorEncoder.finish()]);
}

interface OpaquePassOptions {
  readonly colorEncoder: GPUCommandEncoder;
  readonly context: DrawCallContext;
  readonly frame: FrameOptions;
  readonly needsTransparency: boolean;
  readonly resolvedOverlay: boolean;
  readonly orbitPivotActive: boolean;
  readonly swapChainView: GPUTextureView;
  readonly targets: ReadyColorTargets;
  readonly timestampFrame: GpuTimestampFrame | undefined;
}

function drawOpaquePass(options: OpaquePassOptions): void {
  const {
    colorEncoder,
    context,
    frame,
    needsTransparency,
    resolvedOverlay,
    orbitPivotActive,
    swapChainView,
    targets,
    timestampFrame,
  } = options;
  frame.draw.cost.pass("opaque");
  const opaquePass = beginColorPass(
    colorEncoder,
    targets.color.createView({ label: "femgx opaque color view" }),
    targets.depth.createView({ label: "femgx opaque depth view" }),
    needsTransparency
      ? requireWeightedTargets(targets).opaqueColor.createView({
          label: "femgx opaque transparency view",
        })
      : swapChainView,
    timestampFrame?.writes("opaque"),
  );
  pushDebugGroup(opaquePass, "authored opaque geometry");
  opaquePass.setPipeline(frame.resources.background.pipeline);
  opaquePass.setBindGroup(0, frame.resources.frameBindGroup);
  opaquePass.setBindGroup(1, frame.resources.background.bindGroup);
  opaquePass.draw(3);
  frame.draw.cost.draw("background", 3);
  drawAuthoredPrimitiveGroups(opaquePass, frame.draw, context, frame.calls, { pass: "color" });
  drawSectionCaps(opaquePass, frame.draw, drawSectionCapContext(frame), frame.capCalls, "color");
  if (frame.originTriadEnabled && frame.resources.originTriad !== undefined) {
    pushDebugGroup(opaquePass, "helpers");
    drawOriginTriad(opaquePass, frame.resources.originTriad, "visible");
    frame.draw.cost.draw("origin-triad", 45);
    drawBatches(opaquePass, frame.draw, context, frame.calls, {
      kind: "surface",
      pass: "color",
      primitive: "points",
    });
    popDebugGroup(opaquePass);
  }
  drawSelectionPass(opaquePass, frame, context, "selection-visible");
  drawOrientationGlyphs(opaquePass, frame, context, frame.calls, "visible");
  if (orbitPivotActive) drawOrbitPivot(opaquePass, frame.resources.orbitPivot, "visible");
  if (orbitPivotActive) frame.draw.cost.draw("pivot", 60);
  if (!needsTransparency && !resolvedOverlay) drawPresentationOverlays(opaquePass, frame, context);
  popDebugGroup(opaquePass);
  opaquePass.end();
}

interface TransparencyPassOptions {
  readonly encoder: GPUCommandEncoder;
  readonly frame: FrameOptions;
  readonly context: DrawCallContext;
  readonly targets: WeightedColorTargets;
  readonly orbitPivotActive: boolean;
  readonly timestampFrame: GpuTimestampFrame | undefined;
}

function drawTransparencyPass(options: TransparencyPassOptions): void {
  const { encoder, frame, context, targets, orbitPivotActive, timestampFrame } = options;
  const pass = beginTransparencyPass(
    encoder,
    {
      accumulationView: targets.msaaAccumulation.createView({
        label: "femgx msaa accumulation view",
      }),
      accumulationResolve: targets.accumulation.createView({
        label: "femgx accumulation resolve view",
      }),
      revealageView: targets.msaaRevealage.createView({ label: "femgx msaa revealage view" }),
      revealageResolve: targets.revealage.createView({ label: "femgx revealage resolve view" }),
    },
    targets.depth.createView({ label: "femgx transparency depth view" }),
    timestampFrame?.writes("transparency"),
  );
  pushDebugGroup(pass, "transparency");
  frame.draw.cost.pass("transparency");
  if (frame.transparentCalls.length > 0) {
    drawBatches(pass, frame.draw, context, frame.transparentCalls, {
      kind: "surface",
      pass: "transparent",
    });
  }
  drawSectionCaps(
    pass,
    frame.draw,
    drawSectionCapContext(frame),
    frame.transparentCapCalls,
    "transparent",
  );
  drawSelectionPass(pass, frame, context, "selection-hidden");
  drawOrientationGlyphs(pass, frame, context, frame.calls, "hidden");
  if (frame.originTriadEnabled && frame.resources.originTriad !== undefined) {
    drawOriginTriad(pass, frame.resources.originTriad, "hidden");
    frame.draw.cost.draw("origin-triad", 45);
  }
  if (orbitPivotActive) drawOrbitPivot(pass, frame.resources.orbitPivot, "hidden");
  if (orbitPivotActive) frame.draw.cost.draw("pivot", 60);
  popDebugGroup(pass);
  pass.end();
}

interface CompositePassOptions {
  readonly encoder: GPUCommandEncoder;
  readonly frame: FrameOptions;
  readonly context: DrawCallContext;
  readonly resolvedOverlay: boolean;
  readonly targets: WeightedColorTargets;
  readonly swapChainView: GPUTextureView;
  readonly timestampFrame: GpuTimestampFrame | undefined;
}

function drawCompositePass(options: CompositePassOptions): void {
  const { encoder, frame, context, targets, swapChainView, timestampFrame, resolvedOverlay } =
    options;
  const pass = beginCompositePass(
    encoder,
    targets.color.createView({ label: "femgx composite color view" }),
    swapChainView,
    targets.depth.createView({ label: "femgx composite depth view" }),
    timestampFrame?.writes("composite"),
  );
  pushDebugGroup(pass, "composite");
  frame.draw.cost.pass("composite");
  pass.setPipeline(frame.resources.composite.pipeline);
  pass.setBindGroup(0, ensureCompositeBindGroup(frame.draw, frame.resources));
  pass.draw(3);
  frame.draw.cost.draw("composite", 3);
  if (!resolvedOverlay) drawPresentationOverlays(pass, frame, context);
  popDebugGroup(pass);
  pass.end();
}

function drawPresentationOverlays(
  pass: GPURenderPassEncoder,
  frame: FrameOptions,
  context: DrawCallContext,
): void {
  if (frame.edgeCalls.length > 0) {
    pushDebugGroup(pass, "edges");
    drawBatches(pass, frame.draw, context, frame.edgeCalls, {
      kind: "edge",
      pipeline: frame.resources.edgeAlwaysPipeline,
    });
    popDebugGroup(pass);
  }
  drawNodeOverlay(pass, frame, context);
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
  const capContext = drawSectionCapContext(frame);
  const pickEncoder = frame.device.createCommandEncoder({ label: "femgx picking frame" });
  const timestampFrame = frame.timestampRecorder?.beginFrame();
  const pickPass = beginPickPass(pickEncoder, frame.pickTargets, timestampFrame?.writes("pick"));
  pushDebugGroup(pickPass, "picking");
  frame.draw.cost.pass("pick");
  drawAuthoredPrimitiveGroups(pickPass, frame.draw, context, frame.calls, { pass: "pick" });
  drawSectionCaps(pickPass, frame.draw, capContext, frame.allCapCalls, "pick");
  popDebugGroup(pickPass);
  pickPass.end();
  if (timestampFrame !== undefined) frame.timestampRecorder?.resolve(pickEncoder, timestampFrame);
  frame.device.queue.submit([pickEncoder.finish()]);
}
