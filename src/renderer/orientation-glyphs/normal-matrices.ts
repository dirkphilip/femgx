import type { PartId } from "../../geometry/part";
import type { PackedSceneRuntime } from "../../scene-runtime/runtime";
import type { OrientationInstanceLayout } from "./groups";
import { normalMatrix3, ORIENTATION_GLYPH_NORMAL_MATRIX_FLOATS } from "./data";
import type {
  OrientationGlyphDrawResources,
  OrientationGlyphPartResource,
  OrientationGlyphState,
} from "./types";

/** Whether any active record needs inverse-transpose occurrence transforms. */
export function needsNormalMatrices(state: OrientationGlyphState): boolean {
  if (state.transform === "normal") return true;
  for (const records of state.parts.values()) {
    if (records.transformModes?.includes(1)) return true;
  }
  return false;
}

/** Packs inverse-transpose matrices at stable part-local occurrence slots. */
export function buildNormalMatrices(
  state: OrientationGlyphState,
  runtime: PackedSceneRuntime,
  layout: OrientationInstanceLayout,
): ReadonlyMap<PartId, Float32Array> {
  const matrices = new Map<PartId, Float32Array>();
  for (const partId of orientationPartIds(state, runtime)) {
    const slots = layout.partLocalSlots.get(partId) ?? new Int32Array();
    const data = new Float32Array(slots.length * ORIENTATION_GLYPH_NORMAL_MATRIX_FLOATS);
    for (let local = 0; local < slots.length; local += 1) {
      const slot = slots[local];
      if (slot === undefined || slot < 0) continue;
      writeNormalMatrix(data, local, runtime, slot, partId);
    }
    matrices.set(partId, data);
  }
  return matrices;
}

/** Uploads changed matrices, retaining one shared transform table per part. */
export function writeNormalMatrices(
  resources: OrientationGlyphDrawResources,
  resource: OrientationGlyphPartResource,
  matrices: ReadonlyMap<PartId, Float32Array>,
): void {
  const nextData = matrices.get(resource.partId);
  if (nextData === undefined) return;
  const slotCount = nextData.length / ORIENTATION_GLYPH_NORMAL_MATRIX_FLOATS;
  if (slotCount > resource.normalCapacity) replaceNormalBuffer(resources, resource, slotCount);
  let changed = false;
  for (let index = 0; index < nextData.length; index += 1) {
    const next = nextData[index] ?? 0;
    if (resource.normalData[index] !== next) changed = true;
    resource.normalData[index] = next;
  }
  if (!changed) return;
  resources.device.queue.writeBuffer(resource.normalBuffer, 0, resource.normalData);
  resources.cost.write("vector-glyph", resource.normalData.byteLength);
}

function orientationPartIds(
  state: OrientationGlyphState,
  runtime: PackedSceneRuntime,
): ReadonlySet<PartId> {
  const partIds = new Set<PartId>();
  for (const binding of state.parts.keys()) {
    if (typeof binding === "number") partIds.add(binding);
    else {
      const slot = runtime.getInstanceSlot(binding);
      const partId = slot === undefined ? undefined : runtime.getPartId(slot);
      if (partId !== undefined) partIds.add(partId);
    }
  }
  return partIds;
}

function writeNormalMatrix(
  target: Float32Array,
  local: number,
  runtime: PackedSceneRuntime,
  slot: number,
  partId: PartId,
): void {
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
  const offset = local * ORIENTATION_GLYPH_NORMAL_MATRIX_FLOATS;
  for (let component = 0; component < 9; component += 1) {
    const column = Math.floor(component / 3);
    const row = component % 3;
    target[offset + column * 4 + row] = matrix[component] ?? 0;
  }
}

function replaceNormalBuffer(
  resources: OrientationGlyphDrawResources,
  resource: OrientationGlyphPartResource,
  slotCount: number,
): void {
  resource.normalBuffer.destroy();
  resource.normalCapacity = Math.max(slotCount, resource.normalCapacity * 2, 1);
  resource.normalData = new Float32Array(
    resource.normalCapacity * ORIENTATION_GLYPH_NORMAL_MATRIX_FLOATS,
  );
  resource.normalBuffer = resources.device.createBuffer({
    label: "femgx orientation glyph normals",
    size: resource.normalData.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  for (const group of resource.groups.values()) group.bindGroup = undefined;
}
