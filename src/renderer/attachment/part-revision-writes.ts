/** A deferred write targeting a retained GPU buffer during revision staging. */
export interface StagedBufferWrite {
  readonly buffer: GPUBuffer;
  readonly offset: number;
  readonly data: Uint8Array;
}

/** Creates a device facade that records writes to live buffers but allocates normally. */
export function createPartRevisionStagingDevice(
  device: GPUDevice,
  protectedBuffers: ReadonlySet<GPUBuffer>,
  writes: StagedBufferWrite[],
): GPUDevice {
  const queue = new Proxy(device.queue, {
    get(target, key, receiver) {
      if (key === "writeBuffer") return stagedWriteBuffer(target, protectedBuffers, writes);
      const value: unknown = Reflect.get(target, key, receiver);
      if (typeof value !== "function") return value;
      const bound: unknown = value.bind(target);
      return bound;
    },
  });
  return new Proxy(device, {
    get(target, key, receiver) {
      if (key === "queue") return queue;
      const value: unknown = Reflect.get(target, key, receiver);
      if (typeof value !== "function") return value;
      const bound: unknown = value.bind(target);
      return bound;
    },
  });
}

function stagedWriteBuffer(
  queue: GPUQueue,
  protectedBuffers: ReadonlySet<GPUBuffer>,
  writes: StagedBufferWrite[],
) {
  return (
    buffer: GPUBuffer,
    offset: number,
    data: BufferSource,
    dataOffset?: number,
    size?: number,
  ): void => {
    if (protectedBuffers.has(buffer)) {
      writes.push({ buffer, offset, data: copyWriteData(data, dataOffset, size) });
      return;
    }
    queue.writeBuffer(buffer, offset, data, dataOffset, size);
  };
}

function copyWriteData(
  data: BufferSource,
  dataOffset: number | undefined,
  size: number | undefined,
) {
  const bytes =
    data instanceof ArrayBuffer
      ? new Uint8Array(data)
      : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  const start = dataOffset ?? 0;
  return bytes.slice(start, size === undefined ? undefined : start + size);
}
