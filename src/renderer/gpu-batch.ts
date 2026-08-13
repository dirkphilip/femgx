import { orderBindGroup } from "./gpu-bind-groups";
import { ensureDeformationBuffer } from "./gpu-deform";
import type { Part } from "../geometry/part";
import {
  uploadNodePart,
  uploadPart,
  type DrawCall,
  type DrawCallContext,
  type DrawResources,
} from "./gpu-draw";
import type { PartResource } from "./gpu-support";

type PipelinePass = "color" | "transparent" | "pick" | "selection-visible" | "selection-hidden";

type DrawIntent =
  | {
      readonly kind: "surface";
      readonly pass: PipelinePass;
      readonly primitive?: "triangles" | "lines" | "points";
    }
  | { readonly kind: "edge"; readonly pipeline: GPURenderPipeline }
  | { readonly kind: "nodes"; readonly pipeline: GPURenderPipeline; readonly selection?: boolean };

/** Issues all instanced draws for the cached per-part calls. */
export function drawBatches(
  pass: GPURenderPassEncoder,
  draw: DrawResources,
  context: DrawCallContext,
  calls: readonly DrawCall[],
  options: DrawIntent = { kind: "surface", pass: "color" },
): void {
  pass.setBindGroup(0, context.frameBindGroup);
  if (
    (options.kind === "surface" && options.pass.startsWith("selection-")) ||
    (options.kind === "nodes" && options.selection === true)
  ) {
    pass.setStencilReference(2);
  }
  let current: GPURenderPipeline | undefined;
  for (const call of calls) {
    current = drawOneBatch(pass, draw, context, call, {
      intent: options,
      current,
    });
  }
}

/** Uploads and draws one part batch, retaining the previous pipeline when skipped. */
function drawOneBatch(
  pass: GPURenderPassEncoder,
  draw: DrawResources,
  context: DrawCallContext,
  call: DrawCall,
  options: { readonly intent: DrawIntent; readonly current: GPURenderPipeline | undefined },
): GPURenderPipeline | undefined {
  const { intent, current } = options;
  const orderKind =
    intent.kind === "nodes"
      ? intent.selection === true
        ? "node-selection"
        : "node"
      : intent.kind === "edge"
        ? "edge"
        : intent.pass === "transparent"
          ? "transparent"
          : intent.pass.startsWith("selection-")
            ? "selection"
            : "opaque";
  const overlay = orderKind === "edge";
  const nodes = intent.kind === "nodes";
  const part = context.parts.get(call.partId);
  const storage = draw.storages.get(call.partId);
  if (part === undefined || storage === undefined) return current;
  if (
    intent.kind === "surface" &&
    intent.primitive !== undefined &&
    part.geometry.primitive !== intent.primitive
  ) {
    return current;
  }
  if (nodes && part.geometry.primitive === "points") return current;
  const geometry = uploadBatchGeometry(draw, context, part, nodes);
  const subset = usesFaceSubset(intent, part, nodes);
  if (overlay && (subset ? geometry.subsetEdgeIndexCount : geometry.edgeIndexCount) === 0) {
    return current;
  }
  if (!overlay && subset && geometry.subsetIndexCount === 0) return current;
  const pipeline =
    intent.kind === "surface"
      ? pipelineFor(part.geometry.primitive, intent.pass, context.pipelines)
      : intent.pipeline;
  if (current !== pipeline) pass.setPipeline(pipeline);
  const deformation = ensureDeformationBuffer(draw.device, draw.deformations, call.partId);
  const group = orderBindGroup(draw.device, context.instanceLayout, storage, orderKind, {
    geometry,
    deformation,
    edge: overlay,
    surfaceSubset: !overlay && subset,
    cache: !nodes && !subset,
  });
  pass.setBindGroup(1, group);
  const count = bindDrawGeometry(pass, geometry, overlay, subset);
  if (count === undefined) return current;
  pass.drawIndexed(count, call.instanceCount);
  return pipeline;
}

function usesFaceSubset(intent: DrawIntent, part: Part, nodes: boolean): boolean {
  return (
    !nodes &&
    !(intent.kind === "surface" && intent.pass.startsWith("selection-")) &&
    part.geometry.primitive === "triangles" &&
    part.geometry.faceSubset !== undefined
  );
}

function uploadBatchGeometry(
  draw: DrawResources,
  context: DrawCallContext,
  part: Part,
  nodes: boolean,
): PartResource {
  const colors = context.resultColors?.get(part.id);
  return nodes ? uploadNodePart(draw, part, colors) : uploadPart(draw, part, colors);
}

function bindDrawGeometry(
  pass: GPURenderPassEncoder,
  geometry: PartResource,
  overlay: boolean,
  subset: boolean,
): number | undefined {
  const vertexBuffer = overlay
    ? subset
      ? (geometry.subsetEdgeVertexBuffer ?? geometry.edgeVertexBuffer)
      : geometry.edgeVertexBuffer
    : subset
      ? (geometry.subsetVertexBuffer ?? geometry.vertexBuffer)
      : geometry.vertexBuffer;
  const indexBuffer = overlay
    ? subset
      ? geometry.subsetEdgeIndexBuffer
      : geometry.edgeIndexBuffer
    : subset
      ? geometry.subsetIndexBuffer
      : geometry.indexBuffer;
  const count = overlay
    ? subset
      ? geometry.subsetEdgeIndexCount
      : geometry.edgeIndexCount
    : subset
      ? geometry.subsetIndexCount
      : geometry.indexCount;
  if (indexBuffer === undefined) return undefined;
  pass.setVertexBuffer(0, vertexBuffer);
  pass.setIndexBuffer(indexBuffer, "uint32");
  return count;
}

function pipelineFor(
  primitive: "triangles" | "lines" | "points",
  pass: PipelinePass,
  pipelines: DrawCallContext["pipelines"],
): GPURenderPipeline {
  switch (primitive) {
    case "triangles":
      return pass === "color"
        ? pipelines.trianglesColor
        : pass === "transparent"
          ? pipelines.trianglesTransparent
          : pass === "selection-visible"
            ? pipelines.trianglesSelectionVisible
            : pass === "selection-hidden"
              ? pipelines.trianglesSelectionHidden
              : pipelines.trianglesPick;
    case "lines":
      return pass === "color"
        ? pipelines.linesColor
        : pass === "transparent"
          ? pipelines.linesTransparent
          : pass === "selection-visible"
            ? pipelines.linesSelectionVisible
            : pass === "selection-hidden"
              ? pipelines.linesSelectionHidden
              : pipelines.linesPick;
    case "points":
      return pass === "color"
        ? pipelines.pointsColor
        : pass === "transparent"
          ? pipelines.pointsTransparent
          : pass === "selection-visible"
            ? pipelines.pointsSelectionVisible
            : pass === "selection-hidden"
              ? pipelines.pointsSelectionHidden
              : pipelines.pointsPick;
  }
}
