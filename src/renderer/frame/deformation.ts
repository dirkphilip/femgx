import type { PartId } from "../../geometry/part";
import type { DeformationState } from "../../results/deform";
import type { GpuCostAccumulator } from "../diagnostics/cost";

/** Bytes of the deformation uniform (scale plus alignment padding). */
export const DEFORMATION_UNIFORM_SIZE = 16;

/**
 * Per-part nodal displacement storage for GPU-side vertex deformation. The
 * buffer holds `nodeCount * 3` floats indexed by `NodeId`, mirroring the
 * `displacements` storage binding in `shaders/scene.ts`.
 */
export interface DeformationStorage {
  readonly buffer: GPUBuffer;
  /** Identity of the uploaded array; a new array triggers a re-upload. */
  source: Float32Array | undefined;
}

/** Concrete uniform state used internally when the viewport passes `undefined`. */
const disabledDeformation: DeformationState = {
  scale: 0,
  displacements: new Map(),
};

/** The draw-path inputs the deformation sync needs to upload and rebind. */
export interface DeformationSync {
  readonly device: GPUDevice;
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
export function syncDeformations(sync: DeformationSync, state: DeformationState | undefined): void {
  const resolved = state ?? disabledDeformation;
  for (const [partId, values] of resolved.displacements) {
    uploadDeformation(sync, partId, values);
  }
  for (const [partId, storage] of sync.deformations) {
    if (storage.source === undefined || resolved.displacements.has(partId)) continue;
    sync.cost?.releaseBuffer(storage.buffer.size);
    storage.buffer.destroy();
    sync.deformations.delete(partId);
    invalidateBindGroups(sync, partId);
  }
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

function uploadDeformation(sync: DeformationSync, partId: PartId, values: Float32Array): void {
  const size = Math.max(4, values.byteLength);
  const current = sync.deformations.get(partId);
  if (current !== undefined && current.source === values && current.buffer.size === size) {
    return;
  }
  if (current !== undefined && current.buffer.size === size) {
    current.source = values;
    sync.device.queue.writeBuffer(current.buffer, 0, values);
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
    invalidateBindGroups(sync, partId);
  }
  sync.deformations.set(partId, { buffer, source: values });
  sync.cost?.allocateBuffer(buffer.size);
  sync.device.queue.writeBuffer(buffer, 0, values);
  sync.cost?.write("deformation", values.byteLength);
}

/** Clears every cached bind group that references a replaced deformation buffer. */
function invalidateBindGroups(sync: DeformationSync, partId: PartId): void {
  const storage = sync.storages.get(partId);
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
