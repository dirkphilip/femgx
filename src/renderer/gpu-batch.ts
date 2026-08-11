import { orderBindGroup } from "./gpu-bind-groups";
import { ensureDeformationBuffer } from "./gpu-deform";
import {
  uploadNodePart,
  uploadPart,
  type DrawCall,
  type DrawCallContext,
  type DrawResources,
} from "./gpu-draw";
import type { PipelinePass } from "./gpu-draw";

/** Inputs shared by one instanced batch draw. */
export interface BatchDrawOptions {
  readonly passKind: PipelinePass;
  readonly overlay: boolean;
  readonly nodes: boolean;
  readonly pipelineOverride: GPURenderPipeline | undefined;
  readonly current: GPURenderPipeline | undefined;
}

/** Uploads and draws one part batch, retaining the previous pipeline when skipped. */
export function drawOneBatch(
  pass: GPURenderPassEncoder,
  draw: DrawResources,
  context: DrawCallContext,
  call: DrawCall,
  options: BatchDrawOptions,
): GPURenderPipeline | undefined {
  const { passKind, overlay, nodes, pipelineOverride, current } = options;
  const part = context.parts.get(call.partId);
  const storage = draw.storages.get(call.partId);
  if (part === undefined || storage === undefined) return current;
  const geometry = nodes ? uploadNodePart(draw, part) : uploadPart(draw, part);
  const subset = !nodes && part.geometry.faceSubset !== undefined;
  if (overlay && (subset ? geometry.subsetEdgeIndexCount : geometry.edgeIndexCount) === 0) {
    return current;
  }
  if (!overlay && subset && geometry.subsetIndexCount === 0) return current;
  const pipeline =
    pipelineOverride ??
    pipelineFor(
      nodes ? "points" : (part.geometry.primitive ?? "triangles"),
      passKind,
      context.pipelines,
    );
  if (current !== pipeline) pass.setPipeline(pipeline);
  const deformation = ensureDeformationBuffer(draw.device, draw.deformations, call.partId);
  const group = orderBindGroup(draw.device, context.instanceLayout, storage, overlay, {
    geometry,
    deformation,
    cache: !nodes,
  });
  pass.setBindGroup(1, group);
  pass.setVertexBuffer(0, geometry.vertexBuffer);
  const buffer = overlay
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
  if (buffer === undefined) return current;
  pass.setIndexBuffer(buffer, "uint32");
  pass.drawIndexed(count, call.instanceCount);
  return pipeline;
}

function pipelineFor(
  primitive: "triangles" | "lines" | "points",
  pass: PipelinePass,
  pipelines: DrawCallContext["pipelines"],
): GPURenderPipeline {
  switch (primitive) {
    case "triangles":
      return pass === "color" ? pipelines.trianglesColor : pipelines.trianglesPick;
    case "lines":
      return pass === "color" ? pipelines.linesColor : pipelines.linesPick;
    case "points":
      return pass === "color" ? pipelines.pointsColor : pipelines.pointsPick;
  }
}
