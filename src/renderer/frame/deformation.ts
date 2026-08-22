import type { PartId } from "../../geometry/part";
import type { DeformationState } from "../../results/deform";
import type { PackedSceneRuntime } from "../../scene-runtime/runtime";
import type { GpuCostAccumulator } from "../diagnostics/cost";
import { partResultBindings, type ResultBindingLayout } from "../resources/result-binding-layout";
import { invalidateBindGroups, sameTables } from "../resources/foundation";
import type { BufferWritePort } from "../resources/buffer-write-port";

/** Bytes of the deformation uniform (scale plus alignment padding). */
export const DEFORMATION_UNIFORM_SIZE = 16;

/**
 * Per-part nodal displacement storage for GPU-side vertex deformation. The
 * buffer holds `nodeCount * 3` floats indexed by `NodeId`, mirroring the
 * `displacements` storage binding in `shaders/scene.ts`.
 */
export interface DeformationStorage {
  readonly buffer: GPUBuffer;
  /** Identities of the uploaded shared/occurrence arrays. */
  source: readonly (Float32Array | undefined)[] | undefined;
}

/** Concrete uniform state used internally when the viewport passes `undefined`. */
const disabledDeformation: DeformationState = {
  scale: 0,
  displacements: new Map(),
};

/** The draw-path inputs the deformation sync needs to upload and rebind. */
export interface DeformationSync {
  readonly device: GPUDevice;
  readonly writePort: BufferWritePort;
  readonly cost?: GpuCostAccumulator;
  readonly deformations: Map<PartId, DeformationStorage>;
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

/**
 * Validates a deformation state: every displacement buffer must hold whole
 * per-node vec3s.
 */
export function validateDeformation(state: DeformationState): void {
  for (const [partId, values] of state.displacements) {
    if (values.length % 3 !== 0) {
      throw new Error(
        `Part ${partId} displacement buffer length ${values.length} is not a multiple of 3`,
      );
    }
  }
}

/**
 * Uploads every part's displacement buffer from the current deformation state,
 * skipping arrays already uploaded and recreating buffers whose size changed.
 * Buffers uploaded from an earlier state that dropped out of the new state are
 * destroyed and removed, so no stale displacement data outlives the state;
 * empty fallback buffers created by the draw path (whose `source` is
 * `undefined`) are left alone. Parts whose buffer was recreated or removed have
 * all cached bind groups (surface, transparency, and edge overlay) cleared so the next draw
 * rebinds the fresh buffer. `undefined` resolves to the disabled identity state.
 */
export function syncDeformations(
  sync: DeformationSync,
  state: DeformationState | undefined,
  runtime?: PackedSceneRuntime,
  layout?: ResultBindingLayout,
  partScope?: ReadonlySet<PartId>,
): void {
  if (state === undefined) {
    for (const [partId, storage] of sync.deformations) {
      if (storage.source === undefined) continue;
      sync.cost?.releaseBuffer(storage.buffer.size);
      storage.buffer.destroy();
      sync.deformations.delete(partId);
      invalidateBindGroups(sync.storages.get(partId));
    }
    return;
  }
  const resolved = state;
  const bindings =
    runtime === undefined || layout === undefined
      ? sharedDeformationBindings(resolved.displacements)
      : partResultBindings(resolved.displacements, runtime, layout, partScope);
  const active = new Set<PartId>();
  for (const binding of bindings) {
    if (binding.values.every((value) => value === undefined)) continue;
    active.add(binding.partId);
    uploadDeformation(sync, binding.partId, binding.values);
  }
  for (const [partId, storage] of sync.deformations) {
    if (storage.source === undefined || active.has(partId)) continue;
    sync.cost?.releaseBuffer(storage.buffer.size);
    storage.buffer.destroy();
    sync.deformations.delete(partId);
    invalidateBindGroups(sync.storages.get(partId));
  }
}

function sharedDeformationBindings(
  source: DeformationState["displacements"],
): readonly { readonly partId: PartId; readonly values: readonly Float32Array[] }[] {
  const bindings: { partId: PartId; values: readonly Float32Array[] }[] = [];
  for (const [partId, value] of source) {
    if (typeof partId !== "number") {
      throw new Error(
        "Deformation synchronization requires an attached scene runtime for occurrence bindings",
      );
    }
    bindings.push({ partId, values: [value] });
  }
  return bindings;
}

/**
 * Returns the displacement buffer bound to a part, creating an empty one for
 * parts without deformation data so every part's bind group stays complete.
 */
export function ensureDeformationBuffer(
  device: GPUDevice,
  deformations: Map<PartId, DeformationStorage>,
  partId: PartId,
  emptyBuffer?: GPUBuffer,
): GPUBuffer {
  const existing = deformations.get(partId);
  if (existing !== undefined) return existing.buffer;
  if (emptyBuffer !== undefined) return emptyBuffer;
  const buffer = device.createBuffer({
    label: "femgx empty deformation storage",
    size: 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  deformations.set(partId, { buffer, source: undefined });
  return buffer;
}

/** Creates the fixed valid deformation binding shared by inactive parts. */
export function createEmptyDeformationBuffer(device: GPUDevice): GPUBuffer {
  return device.createBuffer({
    label: "femgx empty deformation storage",
    size: 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
}

/** Writes the per-frame deformation uniform into its GPU buffer. */
export function writeDeformationUniform(
  device: GPUDevice,
  buffer: GPUBuffer,
  state: DeformationState | undefined,
  cost?: GpuCostAccumulator,
): void {
  const resolved = state ?? disabledDeformation;
  const uniform = new Uint32Array(4);
  const floats = new Float32Array(uniform.buffer);
  floats[0] = resolved.scale;
  device.queue.writeBuffer(buffer, 0, uniform);
  cost?.write("uniform", uniform.byteLength);
}

/** Destroys every per-part deformation buffer owned by the draw path. */
export function destroyDeformationBuffers(
  deformations: Map<PartId, DeformationStorage>,
  cost?: GpuCostAccumulator,
): void {
  for (const storage of deformations.values()) {
    cost?.releaseBuffer(storage.buffer.size);
    storage.buffer.destroy();
  }
}

/** Releases one cached per-part deformation buffer when its geometry changes. */
export function destroyDeformationBuffer(
  deformations: Map<PartId, DeformationStorage>,
  partId: PartId,
  cost?: GpuCostAccumulator,
): void {
  const storage = deformations.get(partId);
  if (storage === undefined) return;
  cost?.releaseBuffer(storage.buffer.size);
  storage.buffer.destroy();
  deformations.delete(partId);
}

function uploadDeformation(
  sync: DeformationSync,
  partId: PartId,
  tables: readonly (Float32Array | undefined)[],
): void {
  const values = deformationData(tables);
  const size = Math.max(4, values.byteLength);
  const current = sync.deformations.get(partId);
  if (current !== undefined && sameTables(current.source, tables) && current.buffer.size === size) {
    return;
  }
  if (current !== undefined && current.buffer.size === size) {
    current.source = tables;
    sync.writePort.writeBuffer(current.buffer, 0, values);
    sync.cost?.write("deformation", values.byteLength);
    return;
  }
  const buffer = sync.device.createBuffer({
    label: "femgx deformation storage",
    size,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  if (current !== undefined) {
    sync.cost?.releaseBuffer(current.buffer.size);
    current.buffer.destroy();
    invalidateBindGroups(sync.storages.get(partId));
  }
  sync.deformations.set(partId, { buffer, source: tables });
  sync.cost?.allocateBuffer(buffer.size);
  sync.writePort.writeBuffer(buffer, 0, values);
  sync.cost?.write("deformation", values.byteLength);
}

function deformationData(tables: readonly (Float32Array | undefined)[]): Float32Array {
  const unique = new Set<Float32Array>();
  for (const table of tables) if (table !== undefined) unique.add(table);
  const headerLength = 1 + tables.length;
  const length = headerLength + [...unique].reduce((total, table) => total + 1 + table.length, 0);
  const data = new Float32Array(length);
  const words = new Uint32Array(data.buffer);
  words[0] = tables.length;
  const offsets = new Map<Float32Array, number>();
  let offset = headerLength;
  for (let local = 0; local < tables.length; local += 1) {
    const table = tables[local];
    if (table === undefined) continue;
    let tableOffset = offsets.get(table);
    if (tableOffset === undefined) {
      tableOffset = offset;
      offsets.set(table, tableOffset);
      words[offset] = table.length / 3;
      data.set(table, offset + 1);
      offset += 1 + table.length;
    }
    words[local + 1] = tableOffset;
  }
  return data;
}

/** Clears every cached bind group that references a replaced deformation buffer. */
