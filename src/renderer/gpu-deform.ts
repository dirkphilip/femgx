import type { PartId } from "../scene/types";

/** Bytes of the deformation uniform (scale + loadCase + loadCaseCount + padding). */
export const DEFORMATION_UNIFORM_SIZE = 16;

/**
 * Per-part nodal displacement storage for GPU-side vertex deformation. The
 * buffer holds `loadCaseCount * nodeCount * 3` floats laid out load-case
 * major and indexed by `NodeId`, mirroring the `displacements` storage
 * binding in `gpu-shaders.ts`.
 */
export interface DeformationStorage {
  readonly buffer: GPUBuffer;
  /** Identity of the uploaded array; a new array triggers a re-upload. */
  source: Float32Array | undefined;
}

/**
 * Per-frame GPU deformation state: the displacement scale, the active load
 * case, and the per-part nodal displacement buffers that feed the vertex
 * shader. `loadCaseCount` of 0 disables deformation entirely.
 */
export interface DeformationState {
  /** Multiplier applied to the active load case's displacement field. */
  readonly scale: number;
  /** Active load case index (`0 <= loadCase < loadCaseCount`). */
  readonly loadCase: number;
  /** Number of load cases stored per part displacement buffer. */
  readonly loadCaseCount: number;
  /**
   * Per-part nodal displacement buffers, one vec3 per model node per load
   * case, load-case major. Each buffer is indexed by `NodeId`, as produced by
   * `nodalDisplacements`; the vertex shader resolves every vertex to its node
   * through the part's per-vertex node pick ids, so any tessellated geometry
   * deforms correctly. Buffers must be divisible by `loadCaseCount * 3` floats.
   */
  readonly displacements: ReadonlyMap<PartId, Float32Array>;
}

/** The no-deformation identity state used before the first `setDeformation`. */
export const defaultDeformation: DeformationState = {
  scale: 0,
  loadCase: 0,
  loadCaseCount: 0,
  displacements: new Map(),
};

/** The draw-path inputs the deformation sync needs to upload and rebind. */
export interface DeformationSync {
  readonly device: GPUDevice;
  readonly deformations: Map<PartId, DeformationStorage>;
  readonly storages: ReadonlyMap<
    PartId,
    { bindGroup: GPUBindGroup | undefined; edgeBindGroup: GPUBindGroup | undefined }
  >;
}

/**
 * Validates a deformation state: the load-case count must be a non-negative
 * integer, the active load case must index into it, and every displacement
 * buffer must hold whole per-vertex vec3s for every load case.
 */
export function validateDeformation(state: DeformationState): void {
  if (!Number.isInteger(state.loadCaseCount) || state.loadCaseCount < 0) {
    throw new Error(
      `Deformation loadCaseCount must be a non-negative integer, got ${state.loadCaseCount}`,
    );
  }
  if (state.loadCaseCount === 0) {
    return;
  }
  if (
    !Number.isInteger(state.loadCase) ||
    state.loadCase < 0 ||
    state.loadCase >= state.loadCaseCount
  ) {
    throw new Error(
      `Deformation loadCase ${state.loadCase} is out of range for ${state.loadCaseCount} load cases`,
    );
  }
  const components = 3 * state.loadCaseCount;
  for (const [partId, values] of state.displacements) {
    if (values.length % components !== 0) {
      throw new Error(
        `Part ${partId} displacement buffer length ${values.length} is not a multiple of ${components}`,
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
 * both cached bind groups (surface and edge overlay) cleared so the next draw
 * rebinds the fresh buffer. `undefined` resolves to the disabled identity state.
 */
export function syncDeformations(sync: DeformationSync, state: DeformationState | undefined): void {
  const resolved = state ?? defaultDeformation;
  for (const [partId, values] of resolved.displacements) {
    uploadDeformation(sync, partId, values);
  }
  for (const [partId, storage] of sync.deformations) {
    if (storage.source === undefined || resolved.displacements.has(partId)) continue;
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
): GPUBuffer {
  const existing = deformations.get(partId);
  if (existing !== undefined) return existing.buffer;
  const buffer = device.createBuffer({
    size: 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  deformations.set(partId, { buffer, source: undefined });
  return buffer;
}

/** Writes the per-frame deformation uniform into its GPU buffer. */
export function writeDeformationUniform(
  device: GPUDevice,
  buffer: GPUBuffer,
  state: DeformationState | undefined,
): void {
  const resolved = state ?? defaultDeformation;
  const uniform = new Uint32Array(4);
  const floats = new Float32Array(uniform.buffer);
  floats[0] = resolved.scale;
  uniform[1] = resolved.loadCase;
  uniform[2] = resolved.loadCaseCount;
  device.queue.writeBuffer(buffer, 0, uniform);
}

/** Destroys every per-part deformation buffer owned by the draw path. */
export function destroyDeformationBuffers(deformations: Map<PartId, DeformationStorage>): void {
  for (const storage of deformations.values()) {
    storage.buffer.destroy();
  }
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
    return;
  }
  const buffer = sync.device.createBuffer({
    size,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  if (current !== undefined) {
    current.buffer.destroy();
    invalidateBindGroups(sync, partId);
  }
  sync.deformations.set(partId, { buffer, source: values });
  sync.device.queue.writeBuffer(buffer, 0, values);
}

/** Clears the cached surface and edge-overlay bind groups for a part. */
function invalidateBindGroups(sync: DeformationSync, partId: PartId): void {
  const storage = sync.storages.get(partId);
  if (storage === undefined) return;
  storage.bindGroup = undefined;
  storage.edgeBindGroup = undefined;
}
