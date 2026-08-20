const MAX_DRAW_ARGUMENT = 0xffffffff;

/** One bounded non-indexed node-sprite draw. */
export interface NodeDraw {
  readonly vertexCount: 4;
  readonly instanceCount: number;
  readonly firstInstance: number;
  /** Aligned byte offset into the occurrence order storage binding. */
  readonly orderByteOffset: number;
}

/**
 * Flattens occurrence and node ordinals into WebGPU's instance dimension.
 * Each draw stays within the unsigned 32-bit arguments accepted by WebGPU.
 */
export function buildNodeDraws(
  nodeCount: number,
  occurrenceCount: number,
  firstOccurrence = 0,
  orderBindingAlignment = 256,
  orderEntriesPerInstance = 1,
): readonly NodeDraw[] {
  if (nodeCount === 0 || occurrenceCount === 0) return [];
  if (nodeCount > MAX_DRAW_ARGUMENT) {
    throw new Error("Node sprite count exceeds WebGPU's 32-bit instance range");
  }
  const orderStride = orderBindingAlignment / Uint32Array.BYTES_PER_ELEMENT;
  if (
    !Number.isInteger(orderStride) ||
    orderStride < 1 ||
    !Number.isInteger(orderEntriesPerInstance) ||
    orderEntriesPerInstance < 1
  ) {
    throw new Error("Node sprite order binding alignment must be a positive multiple of four");
  }
  const draws: NodeDraw[] = [];
  let remaining = occurrenceCount;
  let nextOccurrence = firstOccurrence;
  while (remaining > 0) {
    const orderBase = nextOccurrence - (nextOccurrence % orderStride);
    const firstInstance = (nextOccurrence - orderBase) * nodeCount;
    const capacity = Math.floor((MAX_DRAW_ARGUMENT - firstInstance) / nodeCount);
    if (capacity <= 0) {
      throw new Error("Node sprite draw range exceeds WebGPU's 32-bit instance range");
    }
    const instances = Math.min(remaining, capacity);
    draws.push({
      vertexCount: 4,
      instanceCount: instances * nodeCount,
      firstInstance,
      orderByteOffset: orderBase * Uint32Array.BYTES_PER_ELEMENT * orderEntriesPerInstance,
    });
    remaining -= instances;
    nextOccurrence += instances;
  }
  return draws;
}
