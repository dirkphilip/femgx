export type BufferWriteData = ArrayBuffer | SharedArrayBuffer | ArrayBufferView;

/** The only queue operation a revision stage is allowed to intercept. */
export interface BufferWritePort {
  writeBuffer(
    buffer: GPUBuffer,
    bufferOffset: number,
    data: BufferWriteData,
    dataOffset?: number,
    size?: number,
  ): void;
}

/** Creates the direct write port owned by one genuine WebGPU device. */
export function directBufferWritePort(device: GPUDevice): BufferWritePort {
  return {
    writeBuffer: (buffer, bufferOffset, data, dataOffset, size) => {
      // TypeScript's DOM BufferSource declaration rejects valid ArrayBufferLike views.
      // The WebGPU runtime accepts the full BufferSource/SharedArrayBuffer union.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- the cast bridges the stale DOM declaration at the native boundary.
      const nativeData = data as GPUAllowSharedBufferSource;
      device.queue.writeBuffer(buffer, bufferOffset, nativeData, dataOffset, size);
    },
  };
}
