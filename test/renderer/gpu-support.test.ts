import { describe, expect, it } from "vitest";
import { writeChangedBuffer, type BatchResource } from "../../src/renderer/gpu-support";

describe("GPU instance buffer updates", () => {
  it("writes the initial range and only changed subranges afterward", () => {
    const writes: Array<{ readonly offset: number; readonly size: number }> = [];
    const device = {
      queue: {
        writeBuffer: (_buffer: GPUBuffer, offset: number, data: ArrayBufferView) => {
          writes.push({ offset, size: data.byteLength });
        },
      },
    } as unknown as GPUDevice;
    const resource: BatchResource = {
      buffer: {} as GPUBuffer,
      capacity: 1,
      data: new ArrayBuffer(4),
      initialized: false,
      bindGroup: undefined,
    };
    writeChangedBuffer(device, resource, new Uint8Array([1, 2, 3, 4]).buffer, 4);
    writeChangedBuffer(device, resource, new Uint8Array([1, 9, 3, 4]).buffer, 4);
    expect(writes).toEqual([
      { offset: 0, size: 4 },
      { offset: 1, size: 1 },
    ]);
  });
});
