import type { PartId } from "../../geometry/part";
import type { ResultColorMap, ResultColorTable } from "../../results/colors";
import type { GpuCostAccumulator } from "../diagnostics/cost";

/** One renderer-owned dense scalar table shared by every draw of a reusable part. */
export interface ResultColorStorage {
  readonly buffer: GPUBuffer;
  source: ResultColorTable;
}

/** Draw resources needed to synchronize renderer-owned scalar colors. */
export interface ResultColorDrawResources {
  readonly device: GPUDevice;
  readonly cost?: GpuCostAccumulator;
  readonly resultColors: Map<PartId, ResultColorStorage>;
  readonly emptyResultColorBuffer: GPUBuffer;
  readonly storages: ReadonlyMap<
    PartId,
    {
      bindGroup: GPUBindGroup | undefined;
      nodeBindGroup?: GPUBindGroup | undefined;
      edgeBindGroup: GPUBindGroup | undefined;
      transparentBindGroup?: GPUBindGroup | undefined;
      selectionBindGroup?: GPUBindGroup | undefined;
      subsetSelectionBindGroup?: GPUBindGroup | undefined;
      nodeSelectionBindGroup?: GPUBindGroup | undefined;
      subsetBindGroup?: GPUBindGroup | undefined;
      subsetTransparentBindGroup?: GPUBindGroup | undefined;
    }
  >;
}

/** Creates the fixed valid storage binding shared by parts without scalar results. */
export function createEmptyResultColorBuffer(device: GPUDevice): GPUBuffer {
  return device.createBuffer({
    label: "femgx empty result color storage",
    size: 16,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
}

/** Synchronizes one dense scalar buffer per active reusable part. */
export function syncResultColors(
  draw: ResultColorDrawResources,
  colors: ResultColorMap | undefined,
): void {
  for (const [partId, table] of colors ?? []) uploadResultColors(draw, partId, table);
  for (const [partId, storage] of draw.resultColors) {
    if (colors?.has(partId) === true) continue;
    releaseResultColors(draw, partId, storage);
  }
}

/** Returns the active part table or the shared inactive binding. */
export function resultColorBuffer(
  draw: ResultColorDrawResources,
  partId: PartId,
  fallback?: GPUBuffer,
): GPUBuffer {
  return draw.resultColors.get(partId)?.buffer ?? fallback ?? draw.emptyResultColorBuffer;
}

/** Destroys every dense result buffer owned by the draw path. */
export function destroyResultColorBuffers(draw: ResultColorDrawResources): void {
  for (const storage of draw.resultColors.values()) {
    draw.cost?.releaseBuffer(storage.buffer.size);
    storage.buffer.destroy();
  }
  draw.resultColors.clear();
}

/** Releases one part's dense result buffer. */
export function destroyResultColorBuffer(draw: ResultColorDrawResources, partId: PartId): void {
  const storage = draw.resultColors.get(partId);
  if (storage !== undefined) releaseResultColors(draw, partId, storage);
}

function uploadResultColors(
  draw: ResultColorDrawResources,
  partId: PartId,
  table: ResultColorTable,
): void {
  const current = draw.resultColors.get(partId);
  if (current?.source === table) return;
  const data = resultColorData(table);
  if (current !== undefined && current.buffer.size === data.byteLength) {
    current.source = table;
    draw.device.queue.writeBuffer(current.buffer, 0, data);
    draw.cost?.write("result", data.byteLength);
    return;
  }
  const buffer = draw.device.createBuffer({
    label: "femgx result color storage",
    size: data.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  if (current !== undefined) releaseResultColors(draw, partId, current);
  draw.resultColors.set(partId, { buffer, source: table });
  draw.cost?.allocateBuffer(buffer.size);
  draw.device.queue.writeBuffer(buffer, 0, data);
  draw.cost?.write("result", data.byteLength);
  invalidateBindGroups(draw, partId);
}

function releaseResultColors(
  draw: ResultColorDrawResources,
  partId: PartId,
  storage: ResultColorStorage,
): void {
  draw.cost?.releaseBuffer(storage.buffer.size);
  storage.buffer.destroy();
  draw.resultColors.delete(partId);
  invalidateBindGroups(draw, partId);
}

function resultColorData(table: ResultColorTable): Float32Array {
  const data = new Float32Array(table.values.length + 4);
  data[0] = table.location === "nodal" ? 0 : 1;
  data[1] = table.values.length / 4;
  data.set(table.values, 4);
  return data;
}

function invalidateBindGroups(draw: ResultColorDrawResources, partId: PartId): void {
  const storage = draw.storages.get(partId);
  if (storage === undefined) return;
  storage.bindGroup = undefined;
  storage.nodeBindGroup = undefined;
  storage.transparentBindGroup = undefined;
  storage.edgeBindGroup = undefined;
  storage.selectionBindGroup = undefined;
  storage.subsetSelectionBindGroup = undefined;
  storage.nodeSelectionBindGroup = undefined;
  storage.subsetBindGroup = undefined;
  storage.subsetTransparentBindGroup = undefined;
}
