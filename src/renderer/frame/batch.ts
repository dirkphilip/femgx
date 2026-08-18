import { orderBindGroup } from "../resources/bind-groups";
import type { GpuCostAdmission } from "../diagnostics/cost";
import { ensureDeformationBuffer } from "./deformation";
import {
  drawIntentState,
  geometriesForIntent,
  geometryForPrimitive,
  pipelineAdmission,
  pipelineForIntent,
  selectionRangesForIntent,
  visibilitySkinForIntent,
  type DrawIntent,
  type DrawIntentState,
} from "./draw-admission";
import type { Geometry, Part } from "../../geometry/part";
import {
  uploadNodePart,
  uploadGeometryPart,
  ensureEdgeResources,
  ensureEdgePickResources,
  type DrawCall,
  type DrawCallContext,
  type DrawResources,
  type InstanceStorage,
  type SelectionDrawRange,
} from "../resources/draw-resources";
import type { PartResource } from "../resources/foundation";
import { bindDrawGeometry } from "./geometry-binding";
import { resultColorBuffer } from "../resources/result-colors";

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
    const ranges = selectionRangesForIntent(call, options);
    if (ranges !== undefined) {
      for (const range of ranges) {
        const geometry = geometryForPrimitive(geometries, range.primitive);
        current = drawOneBatch(pass, {
          draw,
          context,
          call,
          geometry,
          intent: options,
          current,
          range,
        });
      }
      continue;
    }
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
    readonly range?: SelectionDrawRange;
  },
): GPURenderPipeline | undefined {
  const preparedBatch = prepareBatch(batch);
  if (preparedBatch === undefined) return batch.current;
  const { draw, call, intent, range, resource, overlay, subset, edgePick, visibilitySkin } =
    preparedBatch;
  const prepared = prepareBatchDraw(pass, preparedBatch);
  const geometryCount = bindDrawGeometry(pass, {
    geometry: resource,
    overlay,
    subset,
    edgePick,
    bindVertexBuffer: intent.kind !== "nodes",
    minimal: prepared.admission === "minimal",
    featureTriangles:
      preparedBatch.geometry?.primitive === "triangles" &&
      prepared.admission !== "minimal" &&
      !overlay &&
      !edgePick,
    visibilitySkin,
  });
  if (geometryCount === undefined) return batch.current;
  const count = range?.indexCount ?? geometryCount;
  pass.drawIndexed(count, call.instanceCount, range?.firstIndex ?? 0, 0, call.firstInstance ?? 0);
  draw.cost.draw(drawCostCategory(intent), count, call.instanceCount);
  draw.cost.admission(prepared.admission);
  return prepared.pipeline;
}

interface PreparedBatch {
  readonly draw: DrawResources;
  readonly context: DrawCallContext;
  readonly call: DrawCall;
  readonly part: Part;
  readonly geometry: Geometry | undefined;
  readonly intent: DrawIntent;
  readonly current: GPURenderPipeline | undefined;
  readonly storage: InstanceStorage;
  readonly resource: PartResource;
  readonly subset: boolean;
  readonly overlay: boolean;
  readonly edgePick: boolean;
  readonly visibilitySkin: DrawCall["visibilitySkin"];
  readonly range: SelectionDrawRange | undefined;
}

function prepareBatch(batch: {
  readonly draw: DrawResources;
  readonly context: DrawCallContext;
  readonly call: DrawCall;
  readonly geometry: Geometry | undefined;
  readonly intent: DrawIntent;
  readonly current: GPURenderPipeline | undefined;
  readonly range?: SelectionDrawRange;
}): PreparedBatch | undefined {
  const { draw, context, call, geometry, intent, range } = batch;
  const { overlay, edgePick, nodes } = drawIntentState(intent);
  if (range !== undefined && range.primitive !== geometry?.primitive) return undefined;
  if (inactiveSelectionSkinRange(call, intent, context, range)) return undefined;
  const storage = draw.storages.get(call.partId);
  const part = context.parts.get(call.partId);
  if (part === undefined || storage === undefined) return undefined;
  if (nodes && part.geometries.every((candidate) => candidate.primitive === "points"))
    return undefined;
  const visibilitySkin = visibilitySkinForIntent(call, geometry, intent, { overlay, edgePick });
  const subset =
    visibilitySkin === undefined &&
    usesFaceSubset({
      intent,
      geometry,
      nodes,
      range,
      exteriorSubsets: context.usesExteriorFaceSubsets,
      callSurfaceSubset: call.surfaceSubset,
    });
  const resource = uploadBatchGeometry(draw, part, geometry, nodes, subset);
  if (
    !hasBatchResources({
      draw,
      part,
      geometry,
      resource,
      overlay,
      edgePick,
      subset,
      visibilitySkin,
    })
  )
    return undefined;
  return {
    ...batch,
    part,
    storage,
    resource,
    subset,
    overlay,
    edgePick,
    visibilitySkin,
    range,
  };
}

function inactiveSelectionSkinRange(
  call: DrawCall,
  intent: DrawIntent,
  context: DrawCallContext,
  range: SelectionDrawRange | undefined,
): boolean {
  return (
    range !== undefined &&
    call.surfaceSubset === true &&
    (intent.kind !== "surface" || intent.surfaceSubset !== true || !context.usesExteriorFaceSubsets)
  );
}

function prepareBatchDraw(
  pass: GPURenderPassEncoder,
  options: {
    readonly draw: DrawResources;
    readonly context: DrawCallContext;
    readonly call: DrawCall;
    readonly part: Part;
    readonly geometry: Geometry | undefined;
    readonly intent: DrawIntent;
    readonly current: GPURenderPipeline | undefined;
    readonly storage: InstanceStorage;
    readonly resource: PartResource;
    readonly subset: boolean;
  },
): { readonly pipeline: GPURenderPipeline; readonly admission: GpuCostAdmission } {
  const { draw, context, call, part, geometry, intent, current, storage, resource, subset } =
    options;
  const { orderKind, overlay, edgePick } = drawIntentState(intent);
  const admission = pipelineAdmission({
    context,
    storage,
    call,
    geometry,
    intent,
    cache: draw.admissionCache,
  });
  pass.setBindGroup(
    0,
    admission === "minimal" && context.minimalFrameBindGroup !== undefined
      ? context.minimalFrameBindGroup
      : context.frameBindGroup,
  );
  const pipeline = pipelineForIntent(intent, geometry, context.pipelines, admission);
  if (current !== pipeline) pass.setPipeline(pipeline);
  pass.setBindGroup(
    1,
    createBatchBindGroup({
      draw,
      context,
      call,
      part,
      storage,
      resource,
      orderKind,
      overlay,
      edgePick,
      subset,
      admission,
    }),
  );
  return { pipeline, admission };
}

function createBatchBindGroup(options: {
  readonly draw: DrawResources;
  readonly context: DrawCallContext;
  readonly call: DrawCall;
  readonly part: Part;
  readonly storage: InstanceStorage;
  readonly resource: PartResource;
  readonly orderKind: DrawIntentState["orderKind"];
  readonly overlay: boolean;
  readonly edgePick: boolean;
  readonly subset: boolean;
  readonly admission: GpuCostAdmission;
}): GPUBindGroup {
  const {
    draw,
    context,
    call,
    part,
    storage,
    resource,
    orderKind,
    overlay,
    edgePick,
    subset,
    admission,
  } = options;
  const deformation = ensureDeformationBuffer(
    draw.device,
    draw.deformations,
    call.partId,
    draw.emptyDeformationBuffer,
  );
  const instanceLayout =
    admission === "minimal" && context.minimalInstanceLayout !== undefined
      ? context.minimalInstanceLayout
      : context.instanceLayout;
  return orderBindGroup(draw.device, instanceLayout, storage, orderKind, {
    geometry: resource,
    deformation,
    resultColors: resultColorBuffer(draw, call.partId, resource.primitiveColorBuffer),
    edge: overlay,
    surfaceSubset: !overlay && subset,
    edgePick,
    admission,
    cache: !edgePick && part.geometries.length === 1,
  });
}

function hasBatchResources(options: {
  readonly draw: DrawResources;
  readonly part: Part;
  readonly geometry: Geometry | undefined;
  readonly resource: PartResource;
  readonly overlay: boolean;
  readonly edgePick: boolean;
  readonly subset: boolean;
  readonly visibilitySkin?: DrawCall["visibilitySkin"];
}): boolean {
  const { draw, part, geometry, resource, overlay, edgePick, subset, visibilitySkin } = options;
  if (
    edgePick &&
    geometry?.primitive === "triangles" &&
    ensureEdgePickResources(draw, part, geometry, resource) === undefined
  )
    return false;
  if (
    overlay &&
    !edgePick &&
    geometry?.primitive === "triangles" &&
    ensureEdgeResources(draw, part, geometry, resource) === undefined
  )
    return false;
  if (edgePick && (resource.edgePick?.indexCount ?? 0) === 0) return false;
  if (overlay && !edgePick && (resource.edge?.edgeIndexCount ?? 0) === 0) return false;
  return !(
    (!overlay && subset && resource.subsetIndexCount === 0) ||
    (!overlay && !subset && visibilitySkin !== undefined && visibilitySkin.indexCount === 0)
  );
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

function usesFaceSubset(options: {
  readonly intent: DrawIntent;
  readonly geometry: Geometry | undefined;
  readonly nodes: boolean;
  readonly range: SelectionDrawRange | undefined;
  readonly exteriorSubsets: boolean;
  readonly callSurfaceSubset: boolean | undefined;
}): boolean {
  const { intent, geometry, nodes, range, exteriorSubsets, callSurfaceSubset } = options;
  const useExteriorSubset = callSurfaceSubset ?? exteriorSubsets;
  const selectedVisibleSubset =
    intent.kind === "surface" &&
    intent.pass === "selection-visible" &&
    intent.surfaceSubset === true &&
    useExteriorSubset &&
    exteriorSubsets;
  const selectedHiddenSubset =
    intent.kind === "surface" &&
    intent.pass === "selection-hidden" &&
    intent.surfaceSubset === true &&
    callSurfaceSubset === true &&
    exteriorSubsets;
  const ordinarySubset =
    intent.kind === "surface" &&
    !intent.pass.startsWith("selection-") &&
    useExteriorSubset &&
    intent.surfaceSubset !== false;
  return (
    !nodes &&
    range === undefined &&
    (selectedVisibleSubset || selectedHiddenSubset || ordinarySubset) &&
    geometry?.primitive === "triangles" &&
    geometry.faceSubset !== undefined
  );
}

function uploadBatchGeometry(
  draw: DrawResources,
  part: Part,
  geometry: Geometry | undefined,
  nodes: boolean,
  subset: boolean,
): PartResource {
  return nodes
    ? uploadNodePart(draw, part)
    : geometry === undefined
      ? (() => {
          throw new Error("Surface draw requires an explicit geometry group");
        })()
      : uploadGeometryPart(draw, part, geometry, subset);
}
