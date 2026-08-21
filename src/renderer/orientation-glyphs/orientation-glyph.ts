import type { PartId } from "../../geometry/part";
import type { ResultBindingId } from "../../results/bindings";
import type { ElementalOrientationRecords } from "../../results/orientation-records";
import type { PackedSceneRuntime } from "../../scene-runtime/runtime";
import type { GpuCostAccumulator } from "../diagnostics/cost";
import type { InstanceStorage } from "../resources/instance-storage";
import {
  orientationGlyphRecordSource,
  ORIENTATION_GLYPH_NORMAL_MATRIX_FLOATS,
  ORIENTATION_GLYPH_RECORD_STRIDE,
  packOrientationRecords,
  sameOrientationGlyphRecordSource,
} from "./data";
import type { OrientationGlyphPipelines } from "./pipelines";
import { effectiveRecordGroups, syncGlyphOrder, type OrientationInstanceLayout } from "./groups";
import { buildNormalMatrices, needsNormalMatrices, writeNormalMatrices } from "./normal-matrices";
import type {
  OrientationGlyphDrawResources,
  OrientationGlyphGroupResource,
  OrientationGlyphPartResource,
  OrientationGlyphState,
} from "./types";

export type {
  OrientationGlyphDrawResources,
  OrientationGlyphGroupResource,
  OrientationGlyphMode,
  OrientationGlyphPartResource,
  OrientationGlyphState,
  OrientationGlyphTransform,
} from "./types";

const PARAMS_SIZE = 16;

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
  if (!Number.isFinite(state.widthPixels) || state.widthPixels < 1 || state.widthPixels > 8) {
    throw new Error(`Elemental orientation glyph widthPixels must be finite and between 1 and 8`);
  }
  const normalMatrices = needsNormalMatrices(state)
    ? buildNormalMatrices(state, runtime, layout)
    : undefined;
  writeParams(resources, state);
  const active = new Set<PartId>();
  for (const binding of effectiveRecordGroups(state.parts, runtime, layout)) {
    const resource = ensurePartResource(resources, binding.partId);
    active.add(binding.partId);
    const activeBindings = new Set<ResultBindingId>();
    for (const resolved of binding.groups) {
      activeBindings.add(resolved.bindingId);
      const group = ensureGroupResource(resources, resource, resolved.bindingId, resolved.records);
      syncRecords(resources, group, resolved.records);
      syncGlyphOrder(resources.device, resources.cost, group, resolved.order);
    }
    if (normalMatrices !== undefined) writeNormalMatrices(resources, resource, normalMatrices);
    for (const [bindingId, stale] of resource.groups) {
      if (activeBindings.has(bindingId)) continue;
      destroyGroupResource(stale);
      resource.groups.delete(bindingId);
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
  part: OrientationGlyphPartResource,
  group: OrientationGlyphGroupResource,
): GPUBindGroup {
  if (resources.paramsBuffer === undefined) {
    throw new Error("Orientation glyph parameters are not initialized");
  }
  return (group.bindGroup ??= resources.device.createBindGroup({
    label: "femgx orientation glyph bind group",
    layout: pipelines.layout,
    entries: [
      { binding: 0, resource: { buffer: group.recordBuffer } },
      { binding: 1, resource: { buffer: part.normalBuffer } },
      { binding: 2, resource: { buffer: resources.paramsBuffer } },
    ],
  }));
}

/** Creates the compact instance bind group used by the glyph vertex shader. */
export function orientationGlyphInstanceBindGroup(
  device: GPUDevice,
  group: OrientationGlyphGroupResource,
  pipelines: OrientationGlyphPipelines,
  storage: InstanceStorage,
): GPUBindGroup {
  const sources = [storage.buffer, group.orderBuffer, storage.highlight.buffer] as const;
  const cachedSources = group.instanceBindGroupSources;
  if (
    group.instanceBindGroup !== undefined &&
    cachedSources !== undefined &&
    cachedSources.every((buffer, index) => buffer === sources[index])
  ) {
    return group.instanceBindGroup;
  }
  group.instanceBindGroupSources = sources;
  return (group.instanceBindGroup = device.createBindGroup({
    label: "femgx orientation glyph instance bind group",
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
): OrientationGlyphPartResource {
  const existing = resources.parts.get(partId);
  if (existing !== undefined) return existing;
  const normalBytes = ORIENTATION_GLYPH_NORMAL_MATRIX_FLOATS * Float32Array.BYTES_PER_ELEMENT;
  const resource: OrientationGlyphPartResource = {
    partId,
    normalBuffer: resources.device.createBuffer({
      label: "femgx orientation glyph normals",
      size: normalBytes,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    }),
    normalData: new Float32Array(0),
    normalCapacity: 0,
    groups: new Map(),
  };
  resources.parts.set(partId, resource);
  return resource;
}

function ensureGroupResource(
  resources: OrientationGlyphDrawResources,
  part: OrientationGlyphPartResource,
  bindingId: ResultBindingId,
  records: ElementalOrientationRecords,
): OrientationGlyphGroupResource {
  const existing = part.groups.get(bindingId);
  if (existing !== undefined) return existing;
  const recordBytes = Math.max(4, records.elementIds.length * ORIENTATION_GLYPH_RECORD_STRIDE);
  const recordBuffer = resources.device.createBuffer({
    label: "femgx orientation glyph records",
    size: recordBytes,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  let orderBuffer: GPUBuffer;
  try {
    orderBuffer = resources.device.createBuffer({
      label: "femgx orientation glyph order",
      size: 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
  } catch (error) {
    recordBuffer.destroy();
    throw error;
  }
  const group: OrientationGlyphGroupResource = {
    bindingId,
    recordBuffer,
    recordData: new Uint8Array(recordBytes),
    recordCapacity: Math.floor(recordBytes / ORIENTATION_GLYPH_RECORD_STRIDE),
    recordCount: 0,
    source: undefined,
    orderBuffer,
    orderData: new Uint32Array(1),
    orderCapacity: 1,
    orderCount: 0,
    bindGroup: undefined,
    instanceBindGroup: undefined,
    instanceBindGroupSources: undefined,
  };
  part.groups.set(bindingId, group);
  return group;
}

function syncRecords(
  resources: OrientationGlyphDrawResources,
  resource: OrientationGlyphGroupResource,
  records: ElementalOrientationRecords,
): void {
  if (sameOrientationGlyphRecordSource(resource.source, records)) return;
  const packed = packOrientationRecords(records);
  if (packed.byteLength !== resource.recordBuffer.size) {
    const recordBuffer = resources.device.createBuffer({
      label: "femgx orientation glyph records",
      size: packed.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    resource.recordBuffer.destroy();
    resource.recordBuffer = recordBuffer;
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

function writeParams(resources: OrientationGlyphDrawResources, state: OrientationGlyphState): void {
  const floats = new Float32Array(resources.paramsData);
  const ids = new Uint32Array(resources.paramsData);
  const mode = state.mode === "axis" ? 1 : state.mode === "triad" ? 2 : 0;
  const transform = state.transform === "normal" ? 1 : 0;
  if (
    floats[0] === state.lengthScale &&
    ids[1] === mode &&
    ids[2] === transform &&
    floats[3] === state.widthPixels
  )
    return;
  floats[0] = state.lengthScale;
  ids[1] = mode;
  ids[2] = transform;
  floats[3] = state.widthPixels;
  resources.paramsBuffer ??= resources.device.createBuffer({
    label: "femgx orientation glyph parameters",
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
  for (const group of resource.groups.values()) destroyGroupResource(group);
  resource.normalBuffer.destroy();
}

function destroyGroupResource(resource: OrientationGlyphGroupResource): void {
  resource.recordBuffer.destroy();
  resource.orderBuffer.destroy();
}
