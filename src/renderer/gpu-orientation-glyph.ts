import type { PartId } from "../geometry/part";
import type { ElementalOrientationRecords } from "../results/orientation-records";
import type { PackedSceneRuntime } from "../scene-runtime/runtime";
import type { GpuCostAccumulator } from "./gpu-cost";
import type { InstanceStorage } from "./gpu-instance-storage";
import {
  normalMatrix3,
  orientationGlyphRecordSource,
  ORIENTATION_GLYPH_NORMAL_MATRIX_FLOATS,
  ORIENTATION_GLYPH_RECORD_STRIDE,
  packOrientationRecords,
  sameOrientationGlyphRecordSource,
  type OrientationGlyphRecordSource,
} from "./gpu-orientation-glyph-data";
import type { OrientationGlyphPipelines } from "./gpu-orientation-glyph-pipelines";

/** Renderer-owned glyph presentation mode. */
export type OrientationGlyphMode = "arrow" | "axis";

/** Renderer-owned occurrence direction transform mode. */
export type OrientationGlyphTransform = "direction" | "normal";

/** Internal handoff from the viewport result resolver to the renderer. */
export interface OrientationGlyphState {
  readonly parts: ReadonlyMap<PartId, ElementalOrientationRecords>;
  readonly mode: OrientationGlyphMode;
  readonly transform: OrientationGlyphTransform;
  readonly lengthScale: number;
}

/** GPU resources retained for one active per-part glyph record array. */
export interface OrientationGlyphPartResource {
  readonly partId: PartId;
  recordBuffer: GPUBuffer;
  recordData: Uint8Array<ArrayBuffer>;
  recordCapacity: number;
  recordCount: number;
  source: OrientationGlyphRecordSource | undefined;
  normalBuffer: GPUBuffer;
  normalData: Float32Array;
  normalCapacity: number;
  bindGroup: GPUBindGroup | undefined;
  instanceBindGroup: GPUBindGroup | undefined;
  instanceBindGroupSources: readonly [GPUBuffer, GPUBuffer, GPUBuffer] | undefined;
}

/** Device-bound owner for all active orientation glyph buffers. */
export interface OrientationGlyphDrawResources {
  readonly device: GPUDevice;
  readonly cost: GpuCostAccumulator;
  paramsBuffer: GPUBuffer | undefined;
  readonly paramsData: ArrayBuffer;
  readonly parts: Map<PartId, OrientationGlyphPartResource>;
  state: OrientationGlyphState | undefined;
}

const PARAMS_SIZE = 16;

interface OrientationInstanceLayout {
  readonly partSlots: ReadonlyMap<PartId, Uint32Array>;
}

/** Creates the persistent parameter buffer and empty per-part resource map. */
export function createOrientationGlyphDrawResources(
  device: GPUDevice,
  cost: GpuCostAccumulator,
): OrientationGlyphDrawResources {
  return {
    device,
    cost,
    paramsBuffer: undefined,
    paramsData: new ArrayBuffer(PARAMS_SIZE),
    parts: new Map(),
    state: undefined,
  };
}

/** Synchronizes active records, normal matrices, and the small glyph uniform. */
export function syncOrientationGlyphs(
  resources: OrientationGlyphDrawResources,
  state: OrientationGlyphState | undefined,
  runtime: PackedSceneRuntime,
  layout: OrientationInstanceLayout,
): void {
  if (state === undefined) {
    clearOrientationGlyphs(resources);
    return;
  }
  if (!Number.isFinite(state.lengthScale) || state.lengthScale <= 0) {
    throw new Error(`Elemental orientation glyph lengthScale must be finite and positive`);
  }
  if (state.transform === "normal") validateNormalMatrices(state, runtime, layout);
  writeParams(resources, state);
  const active = new Set<PartId>();
  for (const [partId, records] of state.parts) {
    if (records.elementIds.length === 0) continue;
    const resource = ensurePartResource(resources, partId, records);
    active.add(partId);
    syncRecords(resources, resource, records);
    if (state.transform === "normal") {
      syncNormalMatrices(resources, resource, runtime, layout, partId);
    }
  }
  for (const [partId, resource] of resources.parts) {
    if (active.has(partId)) continue;
    destroyPartResource(resource);
    resources.parts.delete(partId);
  }
  resources.state = state;
}

/** Creates bind groups after the glyph pipeline layout is available. */
export function orientationGlyphBindGroup(
  resources: OrientationGlyphDrawResources,
  pipelines: OrientationGlyphPipelines,
  resource: OrientationGlyphPartResource,
): GPUBindGroup {
  if (resources.paramsBuffer === undefined) {
    throw new Error("Orientation glyph parameters are not initialized");
  }
  return (resource.bindGroup ??= resources.device.createBindGroup({
    layout: pipelines.layout,
    entries: [
      { binding: 0, resource: { buffer: resource.recordBuffer } },
      { binding: 1, resource: { buffer: resource.normalBuffer } },
      { binding: 2, resource: { buffer: resources.paramsBuffer } },
    ],
  }));
}

/** Creates the compact instance bind group used by the glyph vertex shader. */
export function orientationGlyphInstanceBindGroup(
  device: GPUDevice,
  resource: OrientationGlyphPartResource,
  pipelines: OrientationGlyphPipelines,
  storage: InstanceStorage,
): GPUBindGroup {
  const sources = [storage.buffer, storage.orderBuffer, storage.highlight.buffer] as const;
  const cachedSources = resource.instanceBindGroupSources;
  if (
    resource.instanceBindGroup !== undefined &&
    cachedSources !== undefined &&
    cachedSources.every((buffer, index) => buffer === sources[index])
  ) {
    return resource.instanceBindGroup;
  }
  resource.instanceBindGroupSources = sources;
  return (resource.instanceBindGroup = device.createBindGroup({
    layout: pipelines.instanceLayout,
    entries: [
      { binding: 0, resource: { buffer: sources[0] } },
      { binding: 1, resource: { buffer: sources[1] } },
      { binding: 3, resource: { buffer: sources[2] } },
    ],
  }));
}

/** Releases all per-part glyph buffers and the shared parameter buffer. */
export function destroyOrientationGlyphDrawResources(
  resources: OrientationGlyphDrawResources,
): void {
  clearOrientationGlyphs(resources);
  resources.paramsBuffer?.destroy();
}

/** Releases one obsolete part's glyph buffer during scene reconciliation. */
export function destroyOrientationGlyphPart(
  resources: OrientationGlyphDrawResources,
  partId: PartId,
): void {
  const resource = resources.parts.get(partId);
  if (resource === undefined) return;
  destroyPartResource(resource);
  resources.parts.delete(partId);
}

function ensurePartResource(
  resources: OrientationGlyphDrawResources,
  partId: PartId,
  records: ElementalOrientationRecords,
): OrientationGlyphPartResource {
  const existing = resources.parts.get(partId);
  if (existing !== undefined) return existing;
  const recordBytes = Math.max(4, records.elementIds.length * ORIENTATION_GLYPH_RECORD_STRIDE);
  const normalBytes = ORIENTATION_GLYPH_NORMAL_MATRIX_FLOATS * Float32Array.BYTES_PER_ELEMENT;
  const resource: OrientationGlyphPartResource = {
    partId,
    recordBuffer: resources.device.createBuffer({
      size: recordBytes,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    }),
    recordData: new Uint8Array(recordBytes),
    recordCapacity: Math.floor(recordBytes / ORIENTATION_GLYPH_RECORD_STRIDE),
    recordCount: 0,
    source: undefined,
    normalBuffer: resources.device.createBuffer({
      size: normalBytes,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    }),
    normalData: new Float32Array(0),
    normalCapacity: 0,
    bindGroup: undefined,
    instanceBindGroup: undefined,
    instanceBindGroupSources: undefined,
  };
  resources.parts.set(partId, resource);
  return resource;
}

function syncRecords(
  resources: OrientationGlyphDrawResources,
  resource: OrientationGlyphPartResource,
  records: ElementalOrientationRecords,
): void {
  if (sameOrientationGlyphRecordSource(resource.source, records)) return;
  const packed = packOrientationRecords(records);
  if (packed.byteLength > resource.recordBuffer.size) {
    resource.recordBuffer.destroy();
    resource.recordBuffer = resources.device.createBuffer({
      size: packed.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    resource.recordData = new Uint8Array(packed.byteLength);
    resource.recordCapacity = records.elementIds.length;
    resource.bindGroup = undefined;
  }
  resource.recordData.fill(0);
  resource.recordData.set(packed);
  resources.device.queue.writeBuffer(resource.recordBuffer, 0, packed);
  resources.cost.write("vector-glyph", packed.byteLength);
  resource.recordCount = records.elementIds.length;
  resource.source = orientationGlyphRecordSource(records);
}

function syncNormalMatrices(
  resources: OrientationGlyphDrawResources,
  resource: OrientationGlyphPartResource,
  runtime: PackedSceneRuntime,
  layout: OrientationInstanceLayout,
  partId: PartId,
): void {
  const slots = layout.partSlots.get(partId) ?? new Uint32Array();
  if (slots.length > resource.normalCapacity) {
    resource.normalBuffer.destroy();
    resource.normalCapacity = Math.max(slots.length, resource.normalCapacity * 2, 1);
    resource.normalData = new Float32Array(
      resource.normalCapacity * ORIENTATION_GLYPH_NORMAL_MATRIX_FLOATS,
    );
    resource.normalBuffer = resources.device.createBuffer({
      size: resource.normalData.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    resource.bindGroup = undefined;
  }
  let changed = false;
  for (let local = 0; local < slots.length; local += 1) {
    const slot = slots[local];
    if (slot === undefined) continue;
    let matrix: Float32Array;
    try {
      matrix = normalMatrix3(runtime.instanceWorldTransforms.subarray(slot * 16, slot * 16 + 16));
    } catch (error) {
      const occurrence = runtime.getInstanceId(slot) ?? String(slot);
      throw new Error(
        `Elemental orientation normal transform for occurrence ${occurrence} in part ${partId} is invalid: ${String(error)}`,
        { cause: error },
      );
    }
    const target = local * ORIENTATION_GLYPH_NORMAL_MATRIX_FLOATS;
    for (let component = 0; component < 9; component += 1) {
      const next = matrix[component] ?? 0;
      const column = Math.floor(component / 3);
      const row = component % 3;
      const destination = target + column * 4 + row;
      if (resource.normalData[destination] !== next) changed = true;
      resource.normalData[destination] = next;
    }
  }
  if (!changed) return;
  resources.device.queue.writeBuffer(resource.normalBuffer, 0, resource.normalData);
  resources.cost.write("vector-glyph", resource.normalData.byteLength);
}

function validateNormalMatrices(
  state: OrientationGlyphState,
  runtime: PackedSceneRuntime,
  layout: OrientationInstanceLayout,
): void {
  for (const [partId, records] of state.parts) {
    if (records.elementIds.length === 0) continue;
    const slots = layout.partSlots.get(partId) ?? new Uint32Array();
    for (let local = 0; local < slots.length; local += 1) {
      const slot = slots[local];
      if (slot === undefined) continue;
      try {
        normalMatrix3(runtime.instanceWorldTransforms.subarray(slot * 16, slot * 16 + 16));
      } catch (error) {
        const occurrence = runtime.getInstanceId(slot) ?? String(slot);
        throw new Error(
          `Elemental orientation normal transform for occurrence ${occurrence} in part ${partId} is invalid: ${String(error)}`,
          { cause: error },
        );
      }
    }
  }
}

function writeParams(resources: OrientationGlyphDrawResources, state: OrientationGlyphState): void {
  const floats = new Float32Array(resources.paramsData);
  const ids = new Uint32Array(resources.paramsData);
  const mode = state.mode === "axis" ? 1 : 0;
  const transform = state.transform === "normal" ? 1 : 0;
  if (floats[0] === state.lengthScale && ids[1] === mode && ids[2] === transform) return;
  floats[0] = state.lengthScale;
  ids[1] = mode;
  ids[2] = transform;
  resources.paramsBuffer ??= resources.device.createBuffer({
    size: PARAMS_SIZE,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  resources.device.queue.writeBuffer(resources.paramsBuffer, 0, resources.paramsData);
  resources.cost.write("vector-glyph", PARAMS_SIZE);
}

function clearOrientationGlyphs(resources: OrientationGlyphDrawResources): void {
  for (const resource of resources.parts.values()) destroyPartResource(resource);
  resources.parts.clear();
  resources.state = undefined;
}

function destroyPartResource(resource: OrientationGlyphPartResource): void {
  resource.recordBuffer.destroy();
  resource.normalBuffer.destroy();
}
