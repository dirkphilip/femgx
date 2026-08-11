import type { InstanceStorage } from "./gpu-draw";
import type { PartResource } from "./gpu-support";

/** The per-part draw inputs a bind group addresses. */
export interface PartDrawInputs {
  readonly geometry: PartResource;
  /** Nodal displacement buffer; empty for parts without deformation data. */
  readonly deformation: GPUBuffer;
  /** Node glyph geometry is transient relative to the cached surface bind group. */
  readonly cache?: boolean;
  /** Optional topology body buffers, used for face subsets. */
  readonly topologyBodyRangesBuffer?: GPUBuffer | undefined;
  readonly topologyBodyIdsBuffer?: GPUBuffer | undefined;
}

/**
 * Returns the cached per-part bind group addressing the surface or edge order.
 * Both bind groups bind the part's deformation buffer so displaced vertices are
 * drawn identically in the solid, pick, and edge-overlay passes.
 */
export function orderBindGroup(
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  storage: InstanceStorage,
  overlay: boolean,
  part: PartDrawInputs,
): GPUBindGroup {
  const orderBuffer = overlay ? storage.edgeOrderBuffer : storage.orderBuffer;
  if (part.cache === false) return instanceBindGroup(device, layout, storage, orderBuffer, part);
  return overlay
    ? (storage.edgeBindGroup ??= instanceBindGroup(device, layout, storage, orderBuffer, part))
    : (storage.bindGroup ??= instanceBindGroup(device, layout, storage, orderBuffer, part));
}

/** Creates the per-part bind group addressing the given order buffer. */
function instanceBindGroup(
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  storage: InstanceStorage,
  orderBuffer: GPUBuffer,
  part: PartDrawInputs,
): GPUBindGroup {
  return device.createBindGroup({
    layout,
    entries: [
      { binding: 0, resource: { buffer: storage.buffer } },
      { binding: 1, resource: { buffer: orderBuffer } },
      { binding: 2, resource: { buffer: part.geometry.elementPickIdsBuffer } },
      { binding: 3, resource: { buffer: storage.highlight.buffer } },
      { binding: 4, resource: { buffer: part.deformation } },
      { binding: 5, resource: { buffer: part.geometry.facePickIdsBuffer } },
      { binding: 6, resource: { buffer: part.geometry.nodePickIdsBuffer } },
      // The vertex buffer is also a read-only storage binding for the node-pick
      // pass, avoiding a second GPU copy of the same position array.
      { binding: 7, resource: { buffer: part.geometry.vertexBuffer } },
      {
        binding: 8,
        resource: {
          buffer: part.topologyBodyRangesBuffer ?? part.geometry.topologyBodyRangesBuffer,
        },
      },
      {
        binding: 9,
        resource: { buffer: part.topologyBodyIdsBuffer ?? part.geometry.topologyBodyIdsBuffer },
      },
    ],
  });
}
