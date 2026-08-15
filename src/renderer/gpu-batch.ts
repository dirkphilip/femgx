import { orderBindGroup } from "./gpu-bind-groups";
import { ensureDeformationBuffer } from "./gpu-deform";
import type { Geometry, Part } from "../geometry/part";
import {
  uploadNodePart,
  uploadGeometryPart,
  ensureEdgeResources,
  ensureEdgePickResources,
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
  | { readonly kind: "edge-pick"; readonly pipeline: GPURenderPipeline }
  | {
      readonly kind: "nodes";
      readonly pipeline: GPURenderPipeline;
      readonly selection?: "visible" | "hidden";
    };

interface DrawIntentState {
  readonly orderKind: "opaque" | "transparent" | "edge" | "node" | "selection" | "node-selection";
  readonly overlay: boolean;
  readonly edgePick: boolean;
  readonly nodes: boolean;
}

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
    (options.kind === "nodes" && options.selection !== undefined)
  ) {
    pass.setStencilReference(2);
  }
  let current: GPURenderPipeline | undefined;
  for (const call of calls) {
    const part = context.parts.get(call.partId);
    if (part === undefined) continue;
    const geometries = geometriesForIntent(part, options);
    for (const geometry of geometries) {
      current = drawOneBatch(pass, {
        draw,
        context,
        call,
        geometry,
        intent: options,
        current,
      });
    }
  }
}

/** Uploads and draws one part batch, retaining the previous pipeline when skipped. */
function drawOneBatch(
  pass: GPURenderPassEncoder,
  batch: {
    readonly draw: DrawResources;
    readonly context: DrawCallContext;
    readonly call: DrawCall;
    readonly geometry: Geometry | undefined;
    readonly intent: DrawIntent;
    readonly current: GPURenderPipeline | undefined;
  },
): GPURenderPipeline | undefined {
  const { draw, context, call, geometry, intent, current } = batch;
  const { orderKind, overlay, edgePick, nodes } = drawIntentState(intent);
  const storage = draw.storages.get(call.partId);
  const part = context.parts.get(call.partId);
  if (part === undefined || storage === undefined) return current;
  if (nodes && part.geometries.every((candidate) => candidate.primitive === "points"))
    return current;
  const resource = uploadBatchGeometry(draw, context, part, geometry, nodes);
  const subset = usesFaceSubset(intent, geometry, nodes);
  if (
    edgePick &&
    geometry?.primitive === "triangles" &&
    ensureEdgePickResources(draw, part, geometry, resource) === undefined
  )
    return current;
  if (
    overlay &&
    !edgePick &&
    geometry?.primitive === "triangles" &&
    ensureEdgeResources(draw, part, geometry, resource) === undefined
  )
    return current;
  if (edgePick && (resource.edgePick?.indexCount ?? 0) === 0) return current;
  if (overlay && !edgePick && (resource.edge?.edgeIndexCount ?? 0) === 0) {
    return current;
  }
  if (!overlay && subset && resource.subsetIndexCount === 0) return current;
  const pipeline =
    intent.kind === "surface"
      ? pipelineFor(geometry?.primitive ?? "triangles", intent.pass, context.pipelines)
      : intent.pipeline;
  if (current !== pipeline) pass.setPipeline(pipeline);
  const deformation = ensureDeformationBuffer(draw.device, draw.deformations, call.partId);
  const group = orderBindGroup(draw.device, context.instanceLayout, storage, orderKind, {
    geometry: resource,
    deformation,
    edge: overlay,
    surfaceSubset: !overlay && subset,
    edgePick,
    cache: !edgePick && part.geometries.length === 1,
  });
  pass.setBindGroup(1, group);
  const count = bindDrawGeometry(pass, resource, overlay, subset, edgePick);
  if (count === undefined) return current;
  pass.drawIndexed(count, call.instanceCount);
  draw.cost.draw(drawCostCategory(intent), count, call.instanceCount);
  return pipeline;
}

function drawIntentState(intent: DrawIntent): DrawIntentState {
  if (intent.kind === "nodes") {
    return {
      orderKind: intent.selection === undefined ? "node" : "node-selection",
      overlay: false,
      edgePick: false,
      nodes: true,
    };
  }
  if (intent.kind === "edge") {
    return { orderKind: "edge", overlay: true, edgePick: false, nodes: false };
  }
  if (intent.kind === "edge-pick") {
    return { orderKind: "opaque", overlay: true, edgePick: true, nodes: false };
  }
  return {
    orderKind:
      intent.pass === "transparent"
        ? "transparent"
        : intent.pass.startsWith("selection-")
          ? "selection"
          : "opaque",
    overlay: false,
    edgePick: false,
    nodes: false,
  };
}

function drawCostCategory(
  intent: DrawIntent,
):
  | "opaque"
  | "point-replay"
  | "selection-visible"
  | "selection-hidden"
  | "transparency"
  | "edges"
  | "nodes"
  | "pick" {
  if (intent.kind === "edge" || intent.kind === "edge-pick") return "edges";
  if (intent.kind === "nodes") {
    if (intent.selection === "hidden") return "selection-hidden";
    if (intent.selection === "visible") return "selection-visible";
    return "nodes";
  }
  if (intent.pass === "pick") return "pick";
  if (intent.pass === "transparent") return "transparency";
  if (intent.pass === "selection-visible") return "selection-visible";
  if (intent.pass === "selection-hidden") return "selection-hidden";
  return intent.primitive === "points" ? "point-replay" : "opaque";
}

function usesFaceSubset(
  intent: DrawIntent,
  geometry: Geometry | undefined,
  nodes: boolean,
): boolean {
  return (
    !nodes &&
    !(intent.kind === "surface" && intent.pass.startsWith("selection-")) &&
    geometry?.primitive === "triangles" &&
    geometry.faceSubset !== undefined
  );
}

function uploadBatchGeometry(
  draw: DrawResources,
  context: DrawCallContext,
  part: Part,
  geometry: Geometry | undefined,
  nodes: boolean,
): PartResource {
  const colors = context.resultColors?.get(part.id);
  return nodes
    ? uploadNodePart(draw, part, colors)
    : geometry === undefined
      ? (() => {
          throw new Error("Surface draw requires an explicit geometry group");
        })()
      : uploadGeometryPart(draw, part, geometry, colors);
}

function geometriesForIntent(part: Part, intent: DrawIntent): readonly (Geometry | undefined)[] {
  if (intent.kind === "nodes") return [undefined];
  if (intent.kind === "edge" || intent.kind === "edge-pick") {
    return part.geometries.filter((geometry) => geometry.primitive === "triangles");
  }
  if (intent.primitive === undefined) return part.geometries;
  return part.geometries.filter((geometry) => geometry.primitive === intent.primitive);
}

function bindDrawGeometry(
  pass: GPURenderPassEncoder,
  geometry: PartResource,
  overlay: boolean,
  subset: boolean,
  edgePick: boolean,
): number | undefined {
  const vertexBuffer = edgePick
    ? geometry.edgePick?.vertexBuffer
    : overlay
      ? geometry.edge?.edgeVertexBuffer
      : subset
        ? (geometry.subsetVertexBuffer ?? geometry.vertexBuffer)
        : geometry.vertexBuffer;
  const indexBuffer = edgePick
    ? geometry.edgePick?.indexBuffer
    : overlay
      ? geometry.edge?.edgeIndexBuffer
      : subset
        ? geometry.subsetIndexBuffer
        : geometry.indexBuffer;
  const count = edgePick
    ? geometry.edgePick?.indexCount
    : overlay
      ? geometry.edge?.edgeIndexCount
      : subset
        ? geometry.subsetIndexCount
        : geometry.indexCount;
  if (indexBuffer === undefined || vertexBuffer === undefined || count === undefined)
    return undefined;
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
