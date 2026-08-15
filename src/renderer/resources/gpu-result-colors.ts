import type { PartId } from "../../geometry/part";
import type { PartResource } from "./gpu-support";
import type { GpuCostAccumulator } from "../core/gpu-cost";

/** Draw resources needed to synchronize renderer-owned nodal colors. */
export interface ResultColorDrawResources {
  readonly device: GPUDevice;
  readonly cost?: GpuCostAccumulator;
  readonly parts: ReadonlyMap<PartId, PartResource>;
  readonly primitiveParts?: ReadonlyMap<PartId, ReadonlyMap<string, PartResource>>;
  readonly nodeParts: ReadonlyMap<PartId, PartResource>;
}

/** Result color tail appended to every geometry-position storage buffer. */
export interface ResultColorTail {
  readonly resultColorNodeCount: number;
  readonly data: Float32Array;
}

/** Creates the per-part result color tail and its synchronization state. */
export function createResultColorTail(
  nodePickIds: Uint32Array,
  colors: Float32Array | undefined,
): ResultColorTail {
  const nodeCount = maxNodePickId(nodePickIds) + 1;
  const colorData = colors ?? new Float32Array(nodeCount * 4);
  if (colorData.length !== nodeCount * 4) {
    throw new Error(
      `Result color buffer expects ${nodeCount * 4} values but got ${colorData.length}`,
    );
  }
  return {
    resultColorNodeCount: nodeCount,
    data: resultColorData(colorData, nodeCount, colors !== undefined),
  };
}

/** Appends one result color table and metadata record to geometry positions. */
export function appendResultColorTail(
  positions: Float32Array,
  tail: ResultColorTail,
): { readonly data: Float32Array; readonly offset: number } {
  const offset = positions.length;
  const data = new Float32Array(offset + tail.data.length);
  data.set(positions);
  data.set(tail.data, offset);
  return { data, offset };
}

/** Synchronizes the renderer-owned nodal scalar color buffers. */
export function syncResultColors(
  draw: ResultColorDrawResources,
  colors: ReadonlyMap<PartId, Float32Array> | undefined,
): void {
  const resources =
    draw.primitiveParts === undefined
      ? [...draw.parts]
      : [...draw.primitiveParts].flatMap(([partId, primitiveResources]) =>
          [...primitiveResources.values()].map((resource) => [partId, resource] as const),
        );
  for (const [partId, resource] of [...resources, ...draw.nodeParts]) {
    const next = colors?.get(partId);
    if (next !== undefined) {
      if (next.length !== resource.resultColorNodeCount * 4) {
        throw new Error(
          `Result color buffer for part ${partId} expects ${resource.resultColorNodeCount * 4} values but got ${next.length}`,
        );
      }
      const nextData = resultColorData(next, resource.resultColorNodeCount, true);
      if (resource.resultColorsActive && resource.resultColorsSource === next) continue;
      for (const target of resource.resultColorBuffers) {
        draw.device.queue.writeBuffer(target.buffer, target.offset * 4, nextData);
        draw.cost?.write("result", nextData.byteLength);
      }
      resource.resultColorsSource = next;
      resource.resultColorsActive = true;
      continue;
    }
    if (!resource.resultColorsActive) continue;
    const inactive = resultColorData(
      new Float32Array(resource.resultColorNodeCount * 4),
      resource.resultColorNodeCount,
      false,
    );
    for (const target of resource.resultColorBuffers) {
      draw.device.queue.writeBuffer(target.buffer, target.offset * 4, inactive);
      draw.cost?.write("result", inactive.byteLength);
    }
    resource.resultColorsSource = undefined;
    resource.resultColorsActive = false;
  }
}

function resultColorData(colors: Float32Array, nodeCount: number, active: boolean): Float32Array {
  const data = new Float32Array(colors.length + 4);
  data.set(colors);
  const metadata = colors.length;
  data[metadata] = active ? 0 : -1;
  data[metadata + 1] = nodeCount;
  return data;
}

function maxNodePickId(nodePickIds: Uint32Array): number {
  let max = 0;
  for (const pickId of nodePickIds) max = Math.max(max, pickId);
  return max;
}
