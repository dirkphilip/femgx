import type { Part, PartId } from "../../geometry/part";
import type { DrawCall, DrawCallContext, DrawResources } from "../resources/draw-resources";
import { drawBatches } from "./batch";
import type { FrameOptions } from "./frame-types";
import { popDebugGroup, pushDebugGroup } from "./debug";

/** Internal exact-depth precedence for authored opaque primitive groups. */
export const AUTHORED_PRIMITIVE_PRECEDENCE = ["triangles", "lines", "points"] as const;
type PrimitivePass = "color" | "pick" | "selection-visible";

interface PrimitiveGroupOptions {
  readonly pass: PrimitivePass;
  readonly surfaceSubset?: boolean | undefined;
}

/** Draws authored opaque primitive groups in their deterministic tie order. */
export function drawAuthoredPrimitiveGroups(
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

/** Draws selected surface and node batches in the requested depth variant. */
export function drawSelectionPass(
  pass: GPURenderPassEncoder,
  frame: FrameOptions,
  context: DrawCallContext,
  variant: "selection-visible" | "selection-hidden",
): void {
  if (frame.selectionCalls.length > 0) {
    pushDebugGroup(pass, "selection");
    const useSelectionSkin =
      frame.usesExteriorFaceSubsets &&
      frame.sectionPlane === undefined &&
      frame.transparentCalls.length === 0;
    if (variant === "selection-visible") {
      drawAuthoredPrimitiveGroups(pass, frame.draw, context, frame.selectionCalls, {
        pass: variant,
        surfaceSubset: useSelectionSkin,
      });
    } else {
      drawBatches(pass, frame.draw, context, frame.selectionCalls, {
        kind: "surface",
        pass: variant,
        surfaceSubset: useSelectionSkin,
      });
    }
    popDebugGroup(pass);
  }
  if (frame.selectedNodeCalls.length > 0) {
    pushDebugGroup(pass, "selection");
    drawBatches(pass, frame.draw, context, frame.selectedNodeCalls, {
      kind: "nodes",
      pipeline:
        variant === "selection-visible"
          ? frame.resources.pipelines.nodesSelectionVisible
          : frame.resources.pipelines.nodesSelectionHidden,
      selection: variant === "selection-visible" ? "visible" : "hidden",
    });
    popDebugGroup(pass);
  }
}

/** Draws node annotations in the resolved or opaque presentation pass. */
export function drawNodeOverlay(
  pass: GPURenderPassEncoder,
  frame: FrameOptions,
  context: DrawCallContext,
): void {
  if (frame.nodeCalls.length === 0) return;
  pushDebugGroup(pass, "nodes");
  drawBatches(pass, frame.draw, context, frame.nodeCalls, {
    kind: "nodes",
    pipeline: frame.resources.nodeOverlayPipelines.visible,
  });
  popDebugGroup(pass);
}

/** Builds the shared bind-group inputs for one frame pass. */
export function drawContext(
  frame: FrameOptions,
  parts: ReadonlyMap<PartId, Part>,
): DrawCallContext {
  return {
    frameBindGroup: frame.resources.frameBindGroup,
    minimalFrameBindGroup: frame.resources.minimalFrameBindGroup,
    instanceLayout: frame.resources.instanceLayout,
    minimalInstanceLayout: frame.resources.minimalInstanceLayout,
    parts,
    pipelines: frame.resources.pipelines,
    resultColors: frame.resultColors,
    usesExteriorFaceSubsets: frame.usesExteriorFaceSubsets,
    ...(frame.deformation === undefined ? {} : { deformation: frame.deformation }),
    ...(frame.sectionPlane === undefined ? {} : { sectionPlane: frame.sectionPlane }),
  };
}
