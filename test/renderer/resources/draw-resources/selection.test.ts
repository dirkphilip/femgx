import { expect, it, describe } from "vitest";
import {
  createDrawResources,
  patchInstances,
  uploadPart,
  writeSelectionOrder,
  drawBatches,
  beginColorPass,
  fakeGpuDevice,
  installGpuGlobals,
  subsetPart,
  logicalPointPart,
  mixedPart,
  record,
  drawContext,
} from "./support";

describe("GPU draw path", () => {
  it("binds a visibility skin against the full expanded surface", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const draw = createDrawResources(gpu.device);
      patchInstances(draw, subsetPart.id, [{ slot: 0, data: record(0) }]);
      const indexBuffer = gpu.device.createBuffer({ size: 12, usage: GPUBufferUsage.INDEX });
      const encoder = gpu.device.createCommandEncoder();
      const pass = beginColorPass(
        encoder,
        {} as GPUTextureView,
        {} as GPUTextureView,
        {} as GPUTextureView,
      );
      const context = { ...drawContext(), parts: new Map([[subsetPart.id, subsetPart]]) };
      drawBatches(pass, draw, context, [{ partId: subsetPart.id, instanceCount: 1 }]);
      const resource = draw.primitiveParts.get(subsetPart.id)?.get("triangles");
      if (resource === undefined) throw new Error("Subset resource was not uploaded");
      expect(resource.fullVertexBuffer).toBeDefined();
      drawBatches(pass, draw, context, [
        {
          partId: subsetPart.id,
          instanceCount: 1,
          visibilitySkin: {
            signature: { hash: 1, bodyIds: [], elementIds: [1], hasHidden: true },
            indexBuffer,
            indexCount: 3,
            byteLength: 12,
          },
        },
      ]);
      pass.end();

      expect(resource.fullVertexBuffer).toBeDefined();
      expect(gpu.drawCalls).toEqual([
        { indexCount: 3, instanceCount: 1 },
        { indexCount: 3, instanceCount: 1 },
      ]);
    } finally {
      restore();
    }
  });

  it("uses the face subset for visible and explicitly compact hidden selection", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const draw = createDrawResources(gpu.device);
      const resource = uploadPart(draw, subsetPart);
      expect(resource.subsetIndexCount).toBe(3);

      patchInstances(draw, subsetPart.id, [{ slot: 0, data: record(0) }]);
      writeSelectionOrder(draw, subsetPart.id, new Uint32Array([0]));
      const encoder = gpu.device.createCommandEncoder();
      const pass = beginColorPass(
        encoder,
        {} as GPUTextureView,
        {} as GPUTextureView,
        {} as GPUTextureView,
      );
      drawBatches(
        pass,
        draw,
        { ...drawContext(), parts: new Map([[subsetPart.id, subsetPart]]) },
        [{ partId: subsetPart.id, instanceCount: 1 }],
        { kind: "surface", pass: "selection-visible", surfaceSubset: true },
      );
      drawBatches(
        pass,
        draw,
        { ...drawContext(), parts: new Map([[subsetPart.id, subsetPart]]) },
        [{ partId: subsetPart.id, instanceCount: 1 }],
        { kind: "surface", pass: "selection-hidden", surfaceSubset: true },
      );
      drawBatches(
        pass,
        draw,
        { ...drawContext(), parts: new Map([[subsetPart.id, subsetPart]]) },
        [{ partId: subsetPart.id, instanceCount: 1, surfaceSubset: true }],
        { kind: "surface", pass: "selection-hidden", surfaceSubset: true },
      );
      const supplemental = [
        {
          partId: subsetPart.id,
          instanceCount: 1,
          surfaceSubset: true,
          selectionRanges: [{ primitive: "triangles" as const, firstIndex: 3, indexCount: 3 }],
        },
      ];
      drawBatches(
        pass,
        draw,
        { ...drawContext(), parts: new Map([[subsetPart.id, subsetPart]]) },
        supplemental,
        { kind: "surface", pass: "selection-hidden", surfaceSubset: true },
      );
      drawBatches(
        pass,
        draw,
        {
          ...drawContext(),
          parts: new Map([[subsetPart.id, subsetPart]]),
          usesExteriorFaceSubsets: false,
        },
        [{ partId: subsetPart.id, instanceCount: 1, surfaceSubset: true }],
        { kind: "surface", pass: "selection-hidden", surfaceSubset: true },
      );
      drawBatches(
        pass,
        draw,
        {
          ...drawContext(),
          parts: new Map([[subsetPart.id, subsetPart]]),
          usesExteriorFaceSubsets: false,
        },
        supplemental,
        { kind: "surface", pass: "selection-hidden", surfaceSubset: false },
      );
      pass.end();
      expect(gpu.drawCalls).toEqual([
        { indexCount: 3, instanceCount: 1 },
        { indexCount: 6, instanceCount: 1 },
        { indexCount: 3, instanceCount: 1 },
        { indexCount: 3, instanceCount: 1, firstIndex: 3 },
        { indexCount: 6, instanceCount: 1 },
      ]);
    } finally {
      restore();
    }
  });

  it("keeps ranged selection on full geometry before using the face subset", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const draw = createDrawResources(gpu.device);
      uploadPart(draw, subsetPart);
      patchInstances(draw, subsetPart.id, [
        { slot: 0, data: record(0) },
        { slot: 1, data: record(1) },
      ]);
      writeSelectionOrder(draw, subsetPart.id, new Uint32Array([0, 1]));
      const encoder = gpu.device.createCommandEncoder();
      const pass = beginColorPass(
        encoder,
        {} as GPUTextureView,
        {} as GPUTextureView,
        {} as GPUTextureView,
      );
      drawBatches(
        pass,
        draw,
        { ...drawContext(), parts: new Map([[subsetPart.id, subsetPart]]) },
        [
          {
            partId: subsetPart.id,
            instanceCount: 1,
            firstInstance: 1,
            selectionRanges: [{ primitive: "triangles", firstIndex: 3, indexCount: 3 }],
          },
        ],
        { kind: "surface", pass: "selection-visible", surfaceSubset: true },
      );
      drawBatches(
        pass,
        draw,
        { ...drawContext(), parts: new Map([[subsetPart.id, subsetPart]]) },
        [{ partId: subsetPart.id, instanceCount: 1 }],
        { kind: "surface", pass: "selection-visible", surfaceSubset: true },
      );
      pass.end();
      expect(gpu.drawCalls).toEqual([
        { indexCount: 3, instanceCount: 1, firstIndex: 3, firstInstance: 1 },
        { indexCount: 3, instanceCount: 1 },
      ]);
      expect(gpu.bindGroupCreations).toBe(2);
    } finally {
      restore();
    }
  });

  it("routes retained selection ranges only to matching primitive leaves", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const draw = createDrawResources(gpu.device);
      patchInstances(draw, mixedPart.id, [{ slot: 0, data: record(0) }]);
      writeSelectionOrder(draw, mixedPart.id, new Uint32Array([0]));
      const encoder = gpu.device.createCommandEncoder();
      const pass = beginColorPass(
        encoder,
        {} as GPUTextureView,
        {} as GPUTextureView,
        {} as GPUTextureView,
      );
      drawBatches(
        pass,
        draw,
        { ...drawContext(), parts: new Map([[mixedPart.id, mixedPart]]) },
        [
          {
            partId: mixedPart.id,
            instanceCount: 1,
            selectionRanges: [
              { primitive: "triangles", firstIndex: 0, indexCount: 3 },
              { primitive: "points", firstIndex: 0, indexCount: 6 },
            ],
          },
        ],
        { kind: "surface", pass: "selection-visible" },
      );
      pass.end();
      expect(gpu.drawCalls).toEqual([
        { indexCount: 3, instanceCount: 1 },
        { indexCount: 6, instanceCount: 1 },
      ]);
    } finally {
      restore();
    }
  });

  it("expands logical point centers only at GPU upload", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const draw = createDrawResources(gpu.device);
      const resource = uploadPart(draw, logicalPointPart);
      expect(resource.indexCount).toBe(12);
      expect(gpu.buffers[4]?.size).toBe(96);
      expect(gpu.buffers[5]?.size).toBe(48);
      expect(
        gpu.buffers.find((buffer) => buffer.resource === resource.nodePickIdsBuffer)?.size,
      ).toBe(32);

      const indexWrite = gpu.writes.find((write) => write.buffer === resource.indexBuffer);
      expect(indexWrite).toBeDefined();
      expect(
        Array.from(
          new Uint32Array(
            indexWrite?.bytes.buffer ?? new ArrayBuffer(0),
            indexWrite?.bytes.byteOffset ?? 0,
          ),
        ),
      ).toEqual([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);

      const nodePickWrite = gpu.writes.find((write) => write.buffer === resource.nodePickIdsBuffer);
      expect(nodePickWrite).toBeDefined();
      expect(
        Array.from(
          new Uint32Array(
            nodePickWrite?.bytes.buffer ?? new ArrayBuffer(0),
            nodePickWrite?.bytes.byteOffset ?? 0,
          ),
        ),
      ).toEqual([1, 1, 1, 1, 2, 2, 2, 2]);
    } finally {
      restore();
    }
  });
});
