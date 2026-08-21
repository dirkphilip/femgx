import type { PartId } from "../../geometry/part";
import type { ResultBindingId } from "../../results/bindings";
import type { ElementalOrientationRecords } from "../../results/orientation-records";
import type { PackedSceneRuntime } from "../../scene-runtime/runtime";
import type { GpuCostAccumulator } from "../diagnostics/cost";
import type { OrientationGlyphGroupResource } from "./types";

export interface OrientationInstanceLayout {
  readonly partLocalSlots: ReadonlyMap<PartId, Int32Array>;
}

interface EffectiveRecordGroup {
  readonly bindingId: ResultBindingId;
  readonly records: ElementalOrientationRecords;
  readonly order: Uint32Array;
}

export interface EffectivePartGroups {
  readonly partId: PartId;
  readonly groups: readonly EffectiveRecordGroup[];
}

/** Resolves shared records and occurrence overrides into compact visible orders. */
export function effectiveRecordGroups(
  source: ReadonlyMap<ResultBindingId, ElementalOrientationRecords>,
  runtime: PackedSceneRuntime,
  layout: OrientationInstanceLayout,
): readonly EffectivePartGroups[] {
  const partIds = resultPartIds(source, runtime);
  const parts: EffectivePartGroups[] = [];
  for (const partId of [...partIds].sort((left, right) => left - right)) {
    const groups = recordGroupsForPart(source, runtime, layout, partId);
    if (groups.length > 0) parts.push({ partId, groups });
  }
  return parts;
}

/** Synchronizes one record group's compact part-local occurrence order. */
export function syncGlyphOrder(
  device: GPUDevice,
  cost: GpuCostAccumulator,
  resource: OrientationGlyphGroupResource,
  order: Uint32Array,
): void {
  const same =
    resource.orderCount === order.length &&
    order.every((value, index) => resource.orderData[index] === value);
  if (same) return;
  if (order.length > resource.orderCapacity) replaceOrderBuffer(device, resource, order.length);
  resource.orderData.fill(0);
  resource.orderData.set(order);
  resource.orderCount = order.length;
  device.queue.writeBuffer(resource.orderBuffer, 0, order);
  cost.write("vector-glyph", order.byteLength);
}

function resultPartIds(
  source: ReadonlyMap<ResultBindingId, ElementalOrientationRecords>,
  runtime: PackedSceneRuntime,
): ReadonlySet<PartId> {
  const partIds = new Set<PartId>();
  for (const binding of source.keys()) {
    if (typeof binding === "number") partIds.add(binding);
    else {
      const slot = runtime.getInstanceSlot(binding);
      const partId = slot === undefined ? undefined : runtime.getPartId(slot);
      if (partId !== undefined) partIds.add(partId);
    }
  }
  return partIds;
}

function recordGroupsForPart(
  source: ReadonlyMap<ResultBindingId, ElementalOrientationRecords>,
  runtime: PackedSceneRuntime,
  layout: OrientationInstanceLayout,
  partId: PartId,
): readonly EffectiveRecordGroup[] {
  const groups = new Map<
    ResultBindingId,
    { readonly records: ElementalOrientationRecords; readonly locals: number[] }
  >();
  const shared = source.get(partId);
  for (const [local, slot] of (layout.partLocalSlots.get(partId) ?? []).entries()) {
    if (slot < 0 || !runtime.isInstanceVisible(slot)) continue;
    const occurrenceId = runtime.getInstanceId(slot);
    const override = occurrenceId === undefined ? undefined : source.get(occurrenceId);
    const records = override ?? shared;
    const bindingId = override === undefined ? partId : occurrenceId;
    if (records === undefined || bindingId === undefined || records.elementIds.length === 0)
      continue;
    const group = groups.get(bindingId);
    if (group === undefined) groups.set(bindingId, { records, locals: [local] });
    else group.locals.push(local);
  }
  return [...groups].map(([bindingId, group]) => ({
    bindingId,
    records: group.records,
    order: Uint32Array.from(group.locals),
  }));
}

function replaceOrderBuffer(
  device: GPUDevice,
  resource: OrientationGlyphGroupResource,
  count: number,
): void {
  const orderCapacity = Math.max(count, resource.orderCapacity * 2);
  const orderData = new Uint32Array(orderCapacity);
  const orderBuffer = device.createBuffer({
    label: "femgx orientation glyph order",
    size: orderData.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  resource.orderBuffer.destroy();
  resource.orderCapacity = orderCapacity;
  resource.orderData = orderData;
  resource.orderBuffer = orderBuffer;
  resource.instanceBindGroup = undefined;
  resource.instanceBindGroupSources = undefined;
}
