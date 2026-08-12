import { orderBindGroup } from "./gpu-bind-groups";
import { ensureDeformationBuffer } from "./gpu-deform";
import {
  uploadNodePart,
  uploadPart,
  type DrawCall,
  type DrawCallContext,
  type DrawResources,
} from "./gpu-draw";
import type { PartResource } from "./gpu-support";

type PipelinePass = "color" | "transparent" | "pick";

type DrawIntent =
  | { readonly kind: "surface"; readonly pass: PipelinePass }
  | { readonly kind: "edge"; readonly pipeline: GPURenderPipeline }
  | { readonly kind: "nodes"; readonly pipeline: GPURenderPipeline };

/** Inputs shared by one instanced batch draw. */
export interface BatchDrawOptions {
  readonly intent: DrawIntent;
  readonly current: GPURenderPipeline | undefined;
}

/** Options controlling one collection of instanced draws. */
export type DrawBatchOptions = DrawIntent;

/** Issues all instanced draws for the cached per-part calls. */
export function drawBatches(
  pass: GPURenderPassEncoder,
  draw: DrawResources,
  context: DrawCallContext,
  calls: readonly DrawCall[],
  options: DrawBatchOptions = { kind: "surface", pass: "color" },
): void {
  pass.setBindGroup(0, context.frameBindGroup);
  let current: GPURenderPipeline | undefined;
  for (const call of calls) {
    current = drawOneBatch(pass, draw, context, call, {
      intent: options,
      current,
    });
  }
}

/** Uploads and draws one part batch, retaining the previous pipeline when skipped. */
export function drawOneBatch(
  pass: GPURenderPassEncoder,
  draw: DrawResources,
  context: DrawCallContext,
  call: DrawCall,
  options: BatchDrawOptions,
): GPURenderPipeline | undefined {
  const { intent, current } = options;
  const orderKind =
    intent.kind === "edge"
      ? "edge"
      : intent.kind === "surface" && intent.pass === "transparent"
        ? "transparent"
        : "opaque";
  const overlay = orderKind === "edge";
  const nodes = intent.kind === "nodes";
  const part = context.parts.get(call.partId);
  const storage = draw.storages.get(call.partId);
  if (part === undefined || storage === undefined) return current;
  const geometry = nodes ? uploadNodePart(draw, part) : uploadPart(draw, part);
  const subset =
    !nodes && part.geometry.primitive === "triangles" && part.geometry.faceSubset !== undefined;
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
    cache: !nodes,
  });
  pass.setBindGroup(1, group);
  const count = bindDrawGeometry(pass, geometry, overlay, subset);
  if (count === undefined) return current;
  pass.drawIndexed(count, call.instanceCount);
  return pipeline;
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
          : pipelines.trianglesPick;
    case "lines":
      return pass === "color"
        ? pipelines.linesColor
        : pass === "transparent"
          ? pipelines.linesTransparent
          : pipelines.linesPick;
    case "points":
      return pass === "color"
        ? pipelines.pointsColor
        : pass === "transparent"
          ? pipelines.pointsTransparent
          : pipelines.pointsPick;
  }
}
