/**
 * Writes the changed contiguous byte ranges of a region into a GPU buffer.
 * Each written range is expanded outward to a 4-byte boundary because
 * `GPUQueue.writeBuffer` rejects byte lengths and offsets that are not a
 * multiple of 4, and instance records change in sub-float byte increments
 * (for example a single alpha byte).
 */
export function writeDiffedRange(
  device: GPUDevice,
  buffer: GPUBuffer,
  baseOffset: number,
  next: Uint8Array<ArrayBuffer>,
  previous: Uint8Array<ArrayBuffer>,
): void {
  let rangeStart = -1;
  for (let index = 0; index < next.length; index++) {
    const changed = next[index] !== previous[index];
    if (changed && rangeStart < 0) rangeStart = index;
    if ((!changed || index === next.length - 1) && rangeStart >= 0) {
      const rangeEnd = changed && index === next.length - 1 ? index + 1 : index;
      const alignedStart = rangeStart - (rangeStart % 4);
      const alignedEnd = Math.min(next.length, rangeEnd + ((4 - (rangeEnd % 4)) % 4));
      device.queue.writeBuffer(
        buffer,
        baseOffset + alignedStart,
        next.subarray(alignedStart, alignedEnd),
      );
      rangeStart = -1;
    }
  }
}

/**
 * Writes the changed u32 subranges of an order list into its buffer, returning
 * the new meaningful length. Zeros beyond `order.length` are written so a
 * shrink clears the trailing entries that would otherwise linger in the
 * compacted draw list.
 */
export function writeOrderBuffer(
  device: GPUDevice,
  buffer: GPUBuffer,
  mirror: Uint32Array,
  order: Uint32Array,
  previousLength: number,
): number {
  const length = Math.max(order.length, previousLength);
  let rangeStart = -1;
  for (let index = 0; index < length; index++) {
    const next = index < order.length ? (order[index] ?? 0) : 0;
    const previous = index < previousLength ? (mirror[index] ?? 0) : 0;
    const changed = index < order.length !== index < previousLength || next !== previous;
    if (changed && rangeStart < 0) rangeStart = index;
    if ((!changed || index === length - 1) && rangeStart >= 0) {
      const rangeEnd = changed && index === length - 1 ? index + 1 : index;
      const chunk = new Uint32Array(rangeEnd - rangeStart);
      for (let i = rangeStart; i < rangeEnd; i++) {
        chunk[i - rangeStart] = i < order.length ? (order[i] ?? 0) : 0;
      }
      device.queue.writeBuffer(buffer, rangeStart * 4, chunk);
      rangeStart = -1;
    }
  }
  mirror.set(order);
  return order.length;
}
