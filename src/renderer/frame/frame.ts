import type { Camera } from "../../camera/camera";
import type { Part } from "../../geometry/part";
import type { PartId } from "../../geometry/part";
import type { DeformationState } from "../../results/deform";
import type { SectionPlane } from "../../math/section-plane";
import type { DrawCall, DrawCallContext, DrawResources } from "../resources/draw-resources";
import { drawBatches } from "./batch";
import { drawOrientationGlyphs } from "../orientation-glyphs/draw";
import type { PickTargets } from "../picking/pick";
import { ensurePickTargets } from "../picking/pick";
import { beginPickPass } from "../picking/pass";
import { beginColorPass, beginCompositePass, beginTransparencyPass } from "../frame/passes";
import type { RenderResources } from "./pipelines";
import { ensureColorTargets, ensureCompositeBindGroup } from "./pipelines";
import type { ReadyColorTargets } from "../resources/color-targets";
import { drawOriginTriad, originTriadScale, writeOriginTriad } from "../overlays/origin-triad";
import { drawOrbitPivot, writeOrbitPivot } from "../overlays/orbit-pivot";
import { drawPresentationOverlayPass, needsResolvedOverlay } from "./presentation-overlay";
import { drawSectionCaps } from "./section-cap-draw";
import { writeFrameUniforms } from "./frame-uniforms";

export { cameraKeyLightDirection, cameraViewDirection, writeFrameUniforms } from "./frame-uniforms";
export { nodeSizeDevicePixels, pointSizeDevicePixels } from "./sizes";

/** Internal exact-depth precedence for authored opaque primitive groups. */
export const AUTHORED_PRIMITIVE_PRECEDENCE = ["triangles", "lines", "points"] as const;
type PrimitivePass = "color" | "pick" | "selection-visible";

interface PrimitiveGroupOptions {
  readonly pass: PrimitivePass;
  readonly surfaceSubset?: boolean | undefined;
}

/** Everything the per-frame command encoding needs from the renderer. */
export interface FrameOptions {
  readonly canvas: HTMLCanvasElement;
  readonly context: GPUCanvasContext;
  readonly device: GPUDevice;
  readonly draw: DrawResources;
  readonly resources: RenderResources;
  /** Swap-chain / MSAA color format matching the configured canvas context. */
  readonly colorFormat: GPUTextureFormat;
  readonly calls: readonly DrawCall[];
  readonly transparentCalls: readonly DrawCall[];
  readonly edgeCalls: readonly DrawCall[];
  readonly nodeCalls: readonly DrawCall[];
  readonly selectionCalls: readonly DrawCall[];
  readonly selectedNodeCalls: readonly DrawCall[];
  /** Whether static exterior face orders remain valid for ordinary and pick draws. */
  readonly usesExteriorFaceSubsets: boolean;
  readonly capCalls?: readonly DrawCall[];
  readonly transparentCapCalls?: readonly DrawCall[];
  readonly allCapCalls?: readonly DrawCall[];
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
  /** Single world-space section plane; `undefined` leaves the scene unclipped. */
  readonly sectionPlane: SectionPlane | undefined;
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
  const targets = ensureColorTargets(frame.draw, {
    width: frame.canvas.width,
    height: frame.canvas.height,
    colorFormat: frame.colorFormat,
    depthFormat: frame.depthFormat,
    requiresTransparency: needsTransparency,
    requiresOverlays: needsResolvedOverlay(frame),
  });
  frame.draw.cost.targets(
    frame.canvas.width,
    frame.canvas.height,
    frame.devicePixelRatio,
    needsTransparency,
  );
  return {
    colorEncoder: frame.device.createCommandEncoder(),
    context: drawContext(frame, parts),
    targets,
    swapChainView: frame.context.getCurrentTexture().createView(),
    needsTransparency,
    orbitPivotActive,
  };
}

/** Encodes and submits one visible color frame without any picking work. */
export function encodeVisibleFrame(
  camera: Camera,
  parts: ReadonlyMap<PartId, Part>,
  frame: FrameOptions,
): void {
  const { colorEncoder, context, targets, swapChainView, needsTransparency, orbitPivotActive } =
    prepareVisibleFrame(camera, parts, frame);
  frame.draw.cost.pass("opaque");
  const opaquePass = beginColorPass(
    colorEncoder,
    targets.color.createView(),
    targets.depth.createView(),
    needsTransparency ? requireWeightedTargets(targets).opaqueColor.createView() : swapChainView,
  );
  opaquePass.setPipeline(frame.resources.background.pipeline);
  opaquePass.setBindGroup(0, frame.resources.frameBindGroup);
  opaquePass.setBindGroup(1, frame.resources.background.bindGroup);
  opaquePass.draw(3);
  frame.draw.cost.draw("background", 3);
  drawAuthoredPrimitiveGroups(opaquePass, frame.draw, context, frame.calls, { pass: "color" });
  drawSectionCaps(opaquePass, frame.draw, context, frame.capCalls, "color");
  if (frame.originTriadEnabled && frame.resources.originTriad !== undefined) {
    drawOriginTriad(opaquePass, frame.resources.originTriad, "visible");
    frame.draw.cost.draw("origin-triad", 45);
    drawBatches(opaquePass, frame.draw, context, frame.calls, {
      kind: "surface",
      pass: "color",
      primitive: "points",
    });
  }
  drawSelectionPass(opaquePass, frame, context, "selection-visible");
  drawOrientationGlyphs(opaquePass, frame, context, frame.calls, "visible");
  if (orbitPivotActive) drawOrbitPivot(opaquePass, frame.resources.orbitPivot, "visible");
  if (orbitPivotActive) frame.draw.cost.draw("pivot", 60);
  if (!needsTransparency && !needsResolvedOverlay(frame)) {
    drawNodeOverlay(opaquePass, frame, context);
  }
  opaquePass.end();
  if (needsTransparency) {
    const weightedTargets = requireWeightedTargets(targets);
    drawTransparencyPass(colorEncoder, frame, context, weightedTargets, orbitPivotActive);
    drawCompositePass(colorEncoder, frame, context, weightedTargets, swapChainView);
  }
  if (needsResolvedOverlay(frame)) {
    drawPresentationOverlayPass(colorEncoder, frame, context, targets, swapChainView);
  }
  frame.device.queue.submit([colorEncoder.finish()]);
}

function drawTransparencyPass(
  encoder: GPUCommandEncoder,
  frame: FrameOptions,
  context: DrawCallContext,
  targets: WeightedColorTargets,
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
  drawSectionCaps(pass, frame.draw, context, frame.transparentCapCalls, "transparent");
  drawSelectionPass(pass, frame, context, "selection-hidden");
  drawOrientationGlyphs(pass, frame, context, frame.calls, "hidden");
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
    if (variant === "selection-visible") {
      drawAuthoredPrimitiveGroups(pass, frame.draw, context, frame.selectionCalls, {
        pass: variant,
        surfaceSubset: frame.sectionPlane === undefined && frame.transparentCalls.length === 0,
      });
    } else {
      drawBatches(pass, frame.draw, context, frame.selectionCalls, {
        kind: "surface",
        pass: variant,
      });
    }
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
  targets: WeightedColorTargets,
  swapChainView: GPUTextureView,
): void {
  const pass = beginCompositePass(
    encoder,
    targets.color.createView(),
    swapChainView,
    targets.depth.createView(),
  );
  frame.draw.cost.pass("composite");
  pass.setPipeline(frame.resources.composite.pipeline);
  pass.setBindGroup(0, ensureCompositeBindGroup(frame.draw, frame.resources));
  pass.draw(3);
  frame.draw.cost.draw("composite", 3);
  if (!needsResolvedOverlay(frame)) drawNodeOverlay(pass, frame, context);
  pass.end();
}

function drawNodeOverlay(
  pass: GPURenderPassEncoder,
  frame: FrameOptions,
  context: DrawCallContext,
): void {
  if (frame.nodeCalls.length === 0) return;
  drawBatches(pass, frame.draw, context, frame.nodeCalls, {
    kind: "nodes",
    pipeline: frame.resources.nodeOverlayPipelines.visible,
  });
}

type WeightedColorTargets = ReadyColorTargets &
  Required<
    Pick<
      ReadyColorTargets,
      "opaqueColor" | "accumulation" | "revealage" | "msaaAccumulation" | "msaaRevealage"
    >
  >;

function requireWeightedTargets(targets: ReadyColorTargets): WeightedColorTargets {
  const { color, depth, opaqueColor, accumulation, revealage, msaaAccumulation, msaaRevealage } =
    targets;
  if (
    opaqueColor === undefined ||
    accumulation === undefined ||
    revealage === undefined ||
    msaaAccumulation === undefined ||
    msaaRevealage === undefined
  ) {
    throw new Error("Weighted transparency targets are unavailable");
  }
  return { color, depth, opaqueColor, accumulation, revealage, msaaAccumulation, msaaRevealage };
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
  drawAuthoredPrimitiveGroups(pickPass, frame.draw, context, frame.calls, { pass: "pick" });
  drawSectionCaps(pickPass, frame.draw, context, frame.allCapCalls, "pick");
  pickPass.end();
  frame.device.queue.submit([pickEncoder.finish()]);
}

/** Draws authored opaque primitive groups in their deterministic tie order. */
function drawAuthoredPrimitiveGroups(
  pass: GPURenderPassEncoder,
  draw: DrawResources,
  context: DrawCallContext,
  calls: readonly DrawCall[],
  options: PrimitiveGroupOptions,
): void {
  for (const primitive of AUTHORED_PRIMITIVE_PRECEDENCE) {
    drawBatches(pass, draw, context, calls, {
      kind: "surface",
      pass: options.pass,
      primitive,
      surfaceSubset: options.surfaceSubset,
    });
  }
}

/** Builds the shared bind-group inputs for one frame pass. */
export function drawContext(
  frame: FrameOptions,
  parts: ReadonlyMap<PartId, Part>,
): DrawCallContext {
  return {
    frameBindGroup: frame.resources.frameBindGroup,
    instanceLayout: frame.resources.instanceLayout,
    parts,
    pipelines: frame.resources.pipelines,
    resultColors: frame.resultColors,
    usesExteriorFaceSubsets: frame.usesExteriorFaceSubsets,
  };
}
