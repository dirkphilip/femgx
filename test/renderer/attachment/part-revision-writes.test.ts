import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createPartRevisionStagingWritePort } from "@/renderer/attachment/part-revision-writes";
import { directBufferWritePort } from "@/renderer/resources/buffer-write-port";
import { fakeGpuDevice, installGpuGlobals } from "../fake-gpu";

const sourcePath = fileURLToPath(
  new URL("../../../src/renderer/attachment/part-revision-writes.ts", import.meta.url),
);

describe("part revision write port", () => {
  it("defers protected writes using typed-array element offsets and sizes", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const protectedBuffer = gpu.device.createBuffer({
        size: 32,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      const writes: {
        readonly buffer: GPUBuffer;
        readonly offset: number;
        readonly data: Uint8Array;
      }[] = [];
      const port = createPartRevisionStagingWritePort(
        directBufferWritePort(gpu.device),
        new Set([protectedBuffer]),
        writes,
      );
      port.writeBuffer(protectedBuffer, 8, new Float32Array([1, 2, 3, 4]), 1, 2);
      port.writeBuffer(protectedBuffer, 0, Uint8Array.from([9, 8, 7, 6]).buffer, 1, 2);

      expect(writes).toHaveLength(2);
      expect(writes[0]?.buffer).toBe(protectedBuffer);
      expect(writes[0]?.offset).toBe(8);
      expect(Array.from(new Float32Array(writes[0]?.data.buffer ?? new ArrayBuffer(0)))).toEqual([
        2, 3,
      ]);
      expect(Array.from(writes[1]?.data ?? [])).toEqual([8, 7]);
      expect(gpu.writes).toHaveLength(0);
    } finally {
      restore();
    }
  });

  it("passes unprotected writes directly and has no native-object proxy", () => {
    const source = readFileSync(sourcePath, "utf8");
    expect(source).not.toContain("new Proxy");
    expect(source).not.toContain("createPartRevisionStagingDevice");

    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const unprotectedBuffer = gpu.device.createBuffer({
        size: 16,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      const port = createPartRevisionStagingWritePort(
        directBufferWritePort(gpu.device),
        new Set(),
        [],
      );
      port.writeBuffer(unprotectedBuffer, 0, new Uint32Array([7]));

      expect(gpu.writes).toHaveLength(1);
      expect(gpu.writes[0]?.buffer).toBe(unprotectedBuffer);
    } finally {
      restore();
    }
  });

  it("preserves byte views and rejects writes outside the source range", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const protectedBuffer = gpu.device.createBuffer({
        size: 32,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      const writes: {
        readonly buffer: GPUBuffer;
        readonly offset: number;
        readonly data: Uint8Array;
      }[] = [];
      const port = createPartRevisionStagingWritePort(
        directBufferWritePort(gpu.device),
        new Set([protectedBuffer]),
        writes,
      );
      const typedSource = new Float32Array(new ArrayBuffer(20), 4, 3);
      typedSource.set([4, 5, 6]);
      port.writeBuffer(protectedBuffer, 0, typedSource, 1, 1);
      const dataViewSource = new DataView(Uint8Array.from([9, 8, 7, 6]).buffer, 1, 2);
      port.writeBuffer(protectedBuffer, 4, dataViewSource, 1, 1);
      if (typeof SharedArrayBuffer !== "undefined") {
        const sharedSource = new SharedArrayBuffer(4);
        new Uint8Array(sharedSource).set([3, 2, 1, 0]);
        port.writeBuffer(protectedBuffer, 8, sharedSource, 1, 2);
      }

      expect(Array.from(writes[0]?.data ?? [])).toEqual(
        Array.from(new Uint8Array(typedSource.buffer, typedSource.byteOffset + 4, 4)),
      );
      expect(Array.from(writes[1]?.data ?? [])).toEqual([7]);
      if (typeof SharedArrayBuffer !== "undefined") {
        expect(writes[2]?.data).toEqual(new Uint8Array([2, 1]));
      }
      expect(() => {
        port.writeBuffer(protectedBuffer, 0, new Uint32Array([1]), 2, 1);
      }).toThrow(RangeError);
      expect(writes).toHaveLength(typeof SharedArrayBuffer === "undefined" ? 2 : 3);
    } finally {
      restore();
    }
  });
});
