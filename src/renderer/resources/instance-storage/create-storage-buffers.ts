import type { GpuCostAccumulator } from "../../diagnostics/cost";

/** Allocates the paired instance buffers and cleans the first if the second allocation fails. */
export function createStorageBuffers(options: {
  readonly device: GPUDevice;
  readonly cost: GpuCostAccumulator;
  readonly size: number;
  readonly createOrderBuffer: () => GPUBuffer;
}): { readonly buffer: GPUBuffer; readonly orderBuffer: GPUBuffer } {
  const buffer = options.device.createBuffer({
    label: "femgx instance storage",
    size: options.size,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  try {
    return { buffer, orderBuffer: options.createOrderBuffer() };
  } catch (error) {
    options.cost.releaseBuffer(buffer.size);
    buffer.destroy();
    throw error;
  }
}
