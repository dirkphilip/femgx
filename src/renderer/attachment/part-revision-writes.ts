import type { BufferWriteData, BufferWritePort } from "../resources/buffer-write-port";

/** A deferred write targeting a retained GPU buffer during revision staging. */
export interface StagedBufferWrite {
  readonly buffer: GPUBuffer;
  readonly offset: number;
  readonly data: Uint8Array;
}

/** Creates a write port that defers only writes targeting retained live buffers. */
export function createPartRevisionStagingWritePort(
  direct: BufferWritePort,
  protectedBuffers: ReadonlySet<GPUBuffer>,
  writes: StagedBufferWrite[],
): BufferWritePort {
  return {
    writeBuffer: stagedWriteBuffer(direct, protectedBuffers, writes),
  };
}

function stagedWriteBuffer(
  direct: BufferWritePort,
  protectedBuffers: ReadonlySet<GPUBuffer>,
  writes: StagedBufferWrite[],
) {
  return (
    buffer: GPUBuffer,
    offset: number,
    data: BufferWriteData,
    dataOffset?: number,
    size?: number,
  ): void => {
    if (protectedBuffers.has(buffer)) {
      writes.push({ buffer, offset, data: copyWriteData(data, dataOffset, size) });
      return;
    }
    direct.writeBuffer(buffer, offset, data, dataOffset, size);
  };
}

function copyWriteData(
  data: BufferWriteData,
  dataOffset: number | undefined,
  size: number | undefined,
) {
  const bytes = sourceBytes(data);
  const elementSize = sourceElementSize(data);
  const startElement = dataOffset ?? 0;
  const sizeElements = size ?? bytes.byteLength / elementSize - startElement;
  validateWriteRange(startElement, sizeElements, bytes.byteLength / elementSize);
  const start = startElement * elementSize;
  const byteSize = sizeElements * elementSize;
  return bytes.slice(start, start + byteSize);
}

function sourceBytes(data: BufferWriteData): Uint8Array {
  if (ArrayBuffer.isView(data))
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return new Uint8Array(data);
}

function sourceElementSize(data: BufferWriteData): number {
  if (!ArrayBuffer.isView(data) || !("BYTES_PER_ELEMENT" in data)) return 1;
  const size = data.BYTES_PER_ELEMENT;
  return typeof size === "number" ? size : 1;
}

function validateWriteRange(start: number, size: number, length: number): void {
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(size) ||
    start < 0 ||
    size < 0 ||
    start > length ||
    size > length - start
  ) {
    throw new RangeError("GPUQueue.writeBuffer dataOffset and size exceed the source data");
  }
}
