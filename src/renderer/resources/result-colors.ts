import type { PartId } from "../../geometry/part";
import type { ResultColorMap, ResultColorTable } from "../../results/colors";
import type { PackedSceneRuntime } from "../../scene-runtime/runtime";
import type { GpuCostAccumulator } from "../diagnostics/cost";
import { partResultBindings, type ResultBindingLayout } from "./result-binding-layout";
import { invalidateBindGroups, sameTables } from "./foundation";

/** One renderer-owned dense scalar table shared by every draw of a reusable part. */
export interface ResultColorStorage {
  readonly buffer: GPUBuffer;
  source: readonly (ResultColorTable | undefined)[];
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
  runtime?: PackedSceneRuntime,
  layout?: ResultBindingLayout,
): void {
  if (colors === undefined) {
    for (const [partId, storage] of draw.resultColors) releaseResultColors(draw, partId, storage);
    return;
  }
  const bindings =
    runtime === undefined || layout === undefined
      ? sharedResultBindings(colors, "Result color synchronization")
      : partResultBindings(colors, runtime, layout);
  const active = new Set<PartId>();
  for (const binding of bindings) {
    if (binding.values.every((value) => value === undefined)) continue;
    active.add(binding.partId);
    uploadResultColors(draw, binding.partId, binding.values);
  }
  for (const [partId, storage] of draw.resultColors) {
    if (active.has(partId)) continue;
    releaseResultColors(draw, partId, storage);
  }
}

function sharedResultBindings<Value>(
  source: ReadonlyMap<number | string, Value>,
  operation: string,
): readonly { readonly partId: PartId; readonly values: readonly Value[] }[] {
  const bindings: { partId: PartId; values: readonly Value[] }[] = [];
  for (const [partId, value] of source) {
    if (typeof partId !== "number") {
      throw new Error(`${operation} requires an attached scene runtime for occurrence bindings`);
    }
    bindings.push({ partId, values: [value] });
  }
  return bindings;
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
  tables: readonly (ResultColorTable | undefined)[],
): void {
  const current = draw.resultColors.get(partId);
  if (sameTables(current?.source, tables)) return;
  const data = resultColorData(tables);
  if (current !== undefined && current.buffer.size === data.byteLength) {
    current.source = tables;
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
  draw.resultColors.set(partId, { buffer, source: tables });
  draw.cost?.allocateBuffer(buffer.size);
  draw.device.queue.writeBuffer(buffer, 0, data);
  draw.cost?.write("result", data.byteLength);
  invalidateBindGroups(draw.storages.get(partId));
}

function releaseResultColors(
  draw: ResultColorDrawResources,
  partId: PartId,
  storage: ResultColorStorage,
): void {
  draw.cost?.releaseBuffer(storage.buffer.size);
  storage.buffer.destroy();
  draw.resultColors.delete(partId);
  invalidateBindGroups(draw.storages.get(partId));
}

function resultColorData(tables: readonly (ResultColorTable | undefined)[]): Float32Array {
  const unique = new Set<ResultColorTable>();
  for (const table of tables) if (table !== undefined) unique.add(table);
  const headerLength = 1 + tables.length;
  const length =
    headerLength + [...unique].reduce((total, table) => total + 4 + table.values.length, 0);
  const data = new Float32Array(length);
  const words = new Uint32Array(data.buffer);
  words[0] = tables.length;
  const offsets = new Map<ResultColorTable, number>();
  let offset = headerLength;
  for (let local = 0; local < tables.length; local += 1) {
    const table = tables[local];
    if (table === undefined) continue;
    let tableOffset = offsets.get(table);
    if (tableOffset === undefined) {
      tableOffset = offset;
      offsets.set(table, tableOffset);
      data[offset] = table.location === "nodal" ? 0 : 1;
      data[offset + 1] = table.values.length / 4;
      data.set(table.values, offset + 4);
      offset += 4 + table.values.length;
    }
    words[local + 1] = tableOffset;
  }
  return data;
}
