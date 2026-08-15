import type { SectionPlane } from "../../math/section-plane";
import type { GpuCostAccumulator } from "../core/gpu-cost";

/** Byte size of the aligned section-plane uniform. */
export const SECTION_PLANE_UNIFORM_SIZE = 16;

/** Writes the active plane, or zeroes the uniform to disable clipping. */
export function writeSectionPlaneUniform(
  device: GPUDevice,
  buffer: GPUBuffer,
  plane: SectionPlane | undefined,
  cost: GpuCostAccumulator,
): void {
  const uniform = new Float32Array([
    plane?.normal[0] ?? 0,
    plane?.normal[1] ?? 0,
    plane?.normal[2] ?? 0,
    plane?.distance ?? 0,
  ]);
  device.queue.writeBuffer(buffer, 0, uniform);
  cost.write("uniform", uniform.byteLength);
}
