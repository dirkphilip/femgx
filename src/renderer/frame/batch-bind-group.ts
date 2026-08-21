import type { Part } from "../../geometry/part";
import type { GpuCostAdmission } from "../diagnostics/cost";
import { orderBindGroup } from "../resources/bind-groups";
import type {
  DrawCall,
  DrawCallContext,
  DrawResources,
  InstanceStorage,
} from "../resources/draw-resources";
import type { PartResource } from "../resources/foundation";
import type { DrawIntentState } from "./draw-admission";
import { ensureDeformationBuffer } from "./deformation";
import { resultColorBuffer } from "../resources/result-colors";

/** Creates the bound per-part resources for one admitted draw batch. */
export function createBatchBindGroup(options: {
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
  readonly orderByteOffset?: number;
  readonly cache?: boolean;
}): GPUBindGroup {
  const { draw, context, call, part, storage, resource, orderKind, overlay, edgePick, subset } =
    options;
  const deformation = ensureDeformationBuffer(
    draw.device,
    draw.deformations,
    call.partId,
    draw.emptyDeformationBuffer,
  );
  const admission = options.admission;
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
    cache:
      options.cache ??
      (!edgePick && part.geometries.length === 1 && call.selectionRanges === undefined),
    ...(options.orderByteOffset === undefined ? {} : { orderByteOffset: options.orderByteOffset }),
  });
}
