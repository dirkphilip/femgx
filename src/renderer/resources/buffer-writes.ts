import type { GpuCostAccumulator, GpuCostWrite } from "../diagnostics/cost";
import type { BufferWritePort } from "./buffer-write-port";

interface OrderWriteOptions {
  readonly previousLength: number;
  readonly cost?: GpuCostAccumulator;
  readonly capture?: (index: number) => void;
}

interface RecordWriteOptions {
  readonly buffer: GPUBuffer;
  readonly next: Uint8Array;
  readonly recordOffset: number;
  readonly recordStride: number;
  readonly recordIndices: readonly number[];
  readonly cost?: GpuCostAccumulator | undefined;
  readonly category?: GpuCostWrite;
}

/** Small fixed gap accepted when joining changed records into one upload. */
const MAX_UNCHANGED_RECORDS_TO_BRIDGE = 2;

/**
 * Writes changed fixed-size records as contiguous, aligned upload ranges.
 * A small deterministic gap is included to trade a few unchanged records for
 * fewer queue submissions without ever spanning a large sparse interval.
 */
export function writeChangedRecordRanges(
  writer: BufferWritePort,
  options: RecordWriteOptions,
): void {
  const changed = [...new Set(options.recordIndices)].sort((left, right) => left - right);
  let rangeStart = -1;
  let previousIndex = -2;
  for (const index of changed) {
    const gap = index - previousIndex - 1;
    if (rangeStart < 0 || gap > MAX_UNCHANGED_RECORDS_TO_BRIDGE) {
      if (rangeStart >= 0) writeRecordRange(writer, options, rangeStart, previousIndex + 1);
      rangeStart = index;
    }
    previousIndex = index;
  }
  if (rangeStart >= 0) writeRecordRange(writer, options, rangeStart, previousIndex + 1);
}

function writeRecordRange(
  writer: BufferWritePort,
  options: RecordWriteOptions,
  startRecord: number,
  endRecord: number,
): void {
  const start = options.recordOffset + startRecord * options.recordStride;
  const end = options.recordOffset + endRecord * options.recordStride;
  writer.writeBuffer(options.buffer, start, options.next.subarray(start, end));
  options.cost?.write(options.category ?? "other", end - start);
}

/**
 * Writes the changed u32 subranges of an order list into its buffer, returning
 * the new meaningful length. Zeros beyond `order.length` are written so a
 * shrink clears the trailing entries that would otherwise linger in the
 * compacted draw list.
 */
export function writeOrderBuffer(
  writer: BufferWritePort,
  buffer: GPUBuffer,
  mirror: Uint32Array,
  order: Uint32Array,
  options: OrderWriteOptions,
): number {
  const { previousLength, cost } = options;
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
      writer.writeBuffer(buffer, rangeStart * 4, chunk);
      cost?.write("order", chunk.byteLength);
      for (let i = rangeStart; i < rangeEnd; i++) {
        options.capture?.(i);
        mirror[i] = chunk[i - rangeStart] ?? 0;
      }
      rangeStart = -1;
    }
  }
  return order.length;
}
