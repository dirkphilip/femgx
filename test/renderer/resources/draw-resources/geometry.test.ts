import { expect, it, describe } from "vitest";
import {
  createDrawResources,
  patchInstances,
  uploadPart,
  ensureEdgePickResources,
  writeDrawOrder,
  drawBatches,
  beginColorPass,
  fakeGpuDevice,
  installGpuGlobals,
  part,
  nodePart,
  authoredEdgePart,
  subsetPart,
  mixedPart,
  record,
  drawContext,
  type DrawCallContext,
  type DrawPipelines,
} from "./support";
import { bindDrawGeometry } from "@/renderer/frame/geometry-binding";
import { uploadNodePart } from "@/renderer/resources/draw-resources";
import { triangleSubsetUploadData, triangleUploadData } from "@/renderer/resources/triangle-upload";

describe("GPU draw path", () => {
  it("retains shared triangle sources and explicit corner connectivity", () => {
    const geometry = {
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0]),
      indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
      nodePickIds: new Uint32Array([11, 12, 13, 14]),
      primitive: "triangles" as const,
    };
    const upload = triangleUploadData(geometry);
    expect(upload.positions).toBe(geometry.positions);
    expect(upload.nodePickIds).toBe(geometry.nodePickIds);
    expect(upload.indices).toEqual(new Uint32Array([0, 1, 2, 3, 4, 5]));
    expect(upload.cornerIndices).toBe(geometry.indices);
    expect(upload.primitiveIds).toEqual(new Uint32Array([0, 0, 0, 1, 1, 1]));

    const subset = triangleSubsetUploadData(geometry, geometry.indices);
    expect(subset.positions).toEqual(geometry.positions);
    expect(subset.nodePickIds).toEqual(geometry.nodePickIds);
    expect(subset.cornerIndices).toEqual(new Uint32Array([0, 1, 2, 0, 2, 3]));
  });

  it("binds retained visibility indices to the full surface vertices", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const resource = uploadPart(createDrawResources(gpu.device), part);
      const fullVertexBuffer = gpu.device.createBuffer({ size: 36, usage: GPUBufferUsage.VERTEX });
      resource.fullVertexBuffer = fullVertexBuffer;
      let boundVertex: GPUBuffer | undefined;
      const pass = {
        setVertexBuffer: (_slot: number, buffer: GPUBuffer) => {
          boundVertex = buffer;
        },
        setIndexBuffer: () => undefined,
      } as unknown as GPURenderPassEncoder;
      const indexBuffer = gpu.device.createBuffer({ size: 12, usage: GPUBufferUsage.INDEX });
      bindDrawGeometry(pass, {
        geometry: resource,
        overlay: false,
        subset: false,
        edgePick: false,
        bindVertexBuffer: true,
        visibilitySkin: {
          signature: { hash: 1, bodyIds: [], elementIds: [1], hasHidden: true },
          indexBuffer,
          indexCount: 3,
          byteLength: 12,
        },
      });
      expect(boundVertex).toBe(fullVertexBuffer);
    } finally {
      restore();
    }
  });

  it("does not bind compact node centers as a vertex buffer", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const resource = uploadNodePart(createDrawResources(gpu.device), nodePart);
      expect(resource.indexBuffer).toBeUndefined();
    } finally {
      restore();
    }
  });

  it("admits plain triangle surfaces minimally and promotes feature state", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const draw = createDrawResources(gpu.device);
      patchInstances(draw, part.id, [{ slot: 0, data: record(0) }]);
      writeDrawOrder(draw, part.id, new Uint32Array([0]));
      const pipelines = {
        minimalTrianglesColor: { name: "minimal-triangles-color" },
        minimalTrianglesTransparent: { name: "minimal-triangles-transparent" },
        trianglesColor: { name: "triangles-color" },
        trianglesTransparent: { name: "triangles-transparent" },
      } as unknown as DrawPipelines;
      const context: DrawCallContext = {
        ...drawContext(),
        frameBindGroup: { name: "feature-frame" } as unknown as GPUBindGroup,
        minimalFrameBindGroup: { name: "minimal-frame" } as unknown as GPUBindGroup,
        minimalInstanceLayout: { name: "minimal-instance" } as unknown as GPUBindGroupLayout,
        pipelines,
      };
      const encoder = gpu.device.createCommandEncoder();
      const pass = beginColorPass(
        encoder,
        {} as GPUTextureView,
        {} as GPUTextureView,
        {} as GPUTextureView,
      );
      drawBatches(pass, draw, context, [{ partId: part.id, instanceCount: 1 }], {
        kind: "surface",
        pass: "color",
      });
      drawBatches(pass, draw, context, [{ partId: part.id, instanceCount: 1 }], {
        kind: "surface",
        pass: "transparent",
      });
      drawBatches(
        pass,
        draw,
        {
          ...context,
          resultColors: new Map([
            [part.id, { location: "elemental" as const, values: new Float32Array(8) }],
          ]),
        },
        [{ partId: part.id, instanceCount: 1 }],
        { kind: "surface", pass: "color" },
      );
      pass.end();
      expect(gpu.pipelineCalls).toEqual([
        pipelines.minimalTrianglesColor,
        pipelines.minimalTrianglesTransparent,
        pipelines.trianglesColor,
      ]);
      expect(draw.cost.snapshot().admissions).toEqual({ minimal: 2, topology: 0, feature: 1 });
      expect(draw.admissionCache.get(part.id)?.admission).toBe("feature");
    } finally {
      restore();
    }
  });

  it("draws every primitive leaf from one semantic part", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const draw = createDrawResources(gpu.device);
      patchInstances(draw, mixedPart.id, [{ slot: 0, data: record(0) }]);
      writeDrawOrder(draw, mixedPart.id, new Uint32Array([0]));
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
        [{ partId: mixedPart.id, instanceCount: 1 }],
        { kind: "surface", pass: "color" },
      );
      pass.end();
      expect(gpu.drawCalls.map((call) => call.indexCount)).toEqual([3, 6, 6]);
      expect(draw.primitiveParts.get(mixedPart.id)?.size).toBe(3);
    } finally {
      restore();
    }
  });

  it("uploads part geometry once and caches it", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const draw = createDrawResources(gpu.device);
      const first = uploadPart(draw, part);
      const second = uploadPart(draw, part);
      expect(second).toBe(first);
      expect(second.indexCount).toBe(3);
      expect(gpu.buffers).toHaveLength(8);
      expect(gpu.buffers[3]?.size).toBe(16);
      expect(gpu.buffers[4]?.size).toBe(36);
      expect(gpu.buffers[5]?.size).toBe(12);
      expect(gpu.buffers[6]?.size).toBe(12);
      expect(gpu.buffers[7]?.size).toBe(76);
      expect(first.minimalIndexBuffer).toBe(first.facePickIdsBuffer);
      expect(first.minimalIndexOffset).toBe(64);
      expect(first.edge).toBeUndefined();
    } finally {
      restore();
    }
  });

  it("keeps authored-edge pick resources lazy and absent for generic parts", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const draw = createDrawResources(gpu.device);
      const generic = uploadPart(draw, part);
      expect(generic.edge).toBeUndefined();
      expect(generic.edgePick).toBeUndefined();
      expect(ensureEdgePickResources(draw, part, generic)).toBeUndefined();

      const authored = uploadPart(draw, authoredEdgePart);
      expect(authored.edge).toBeUndefined();
      expect(authored.edgePick).toBeUndefined();
      const edgePick = ensureEdgePickResources(draw, authoredEdgePart, authored);
      expect(edgePick?.edgeKeys).toEqual(["0,1", "0,2", "1,2"]);
      expect(authored.edgePick).toBe(edgePick);
      expect(authored.edge).toBeUndefined();
    } finally {
      restore();
    }
  });

  it("draws and caches opaque and transparent face-subset bindings", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const draw = createDrawResources(gpu.device);
      const resource = uploadPart(draw, subsetPart);
      expect(resource.indexCount).toBe(6);
      expect(resource.subsetIndexCount).toBe(3);
      expect(resource.subsetIndexBuffer).toBeDefined();
      expect(resource.edge).toBeUndefined();
      expect(gpu.buffers).toHaveLength(12);

      patchInstances(draw, subsetPart.id, [{ slot: 0, data: record(0) }]);
      writeDrawOrder(draw, subsetPart.id, new Uint32Array([0]));
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
        { kind: "surface", pass: "color" },
      );
      drawBatches(
        pass,
        draw,
        { ...drawContext(), parts: new Map([[subsetPart.id, subsetPart]]) },
        [{ partId: subsetPart.id, instanceCount: 1 }],
        { kind: "surface", pass: "color" },
      );
      drawBatches(
        pass,
        draw,
        { ...drawContext(), parts: new Map([[subsetPart.id, subsetPart]]) },
        [{ partId: subsetPart.id, instanceCount: 1 }],
        { kind: "surface", pass: "transparent" },
      );
      drawBatches(
        pass,
        draw,
        { ...drawContext(), parts: new Map([[subsetPart.id, subsetPart]]) },
        [{ partId: subsetPart.id, instanceCount: 1 }],
        { kind: "surface", pass: "transparent" },
      );
      pass.end();
      expect(gpu.drawCalls).toEqual([
        { indexCount: 3, instanceCount: 1 },
        { indexCount: 3, instanceCount: 1 },
        { indexCount: 3, instanceCount: 1 },
        { indexCount: 3, instanceCount: 1 },
      ]);
      expect(gpu.bindGroupCreations).toBe(2);
    } finally {
      restore();
    }
  });

  it("prepares full solid geometry with its first exterior-subset draw", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const draw = createDrawResources(gpu.device);
      patchInstances(draw, subsetPart.id, [{ slot: 0, data: record(0) }]);
      writeDrawOrder(draw, subsetPart.id, new Uint32Array([0]));
      const context = { ...drawContext(), parts: new Map([[subsetPart.id, subsetPart]]) };
      const encoder = gpu.device.createCommandEncoder();
      const pass = beginColorPass(
        encoder,
        {} as GPUTextureView,
        {} as GPUTextureView,
        {} as GPUTextureView,
      );

      drawBatches(pass, draw, context, [{ partId: subsetPart.id, instanceCount: 1 }], {
        kind: "surface",
        pass: "color",
      });
      const resource = draw.primitiveParts.get(subsetPart.id)?.get("triangles");
      if (resource === undefined) throw new Error("Subset resource was not uploaded");
      expect(resource.indexCount).toBe(3);
      expect(resource.fullVertexBuffer).toBeDefined();
      expect(resource.fullIndexCount).toBe(6);
      expect(gpu.buffers).toHaveLength(14);

      drawBatches(pass, draw, context, [{ partId: subsetPart.id, instanceCount: 1 }], {
        kind: "surface",
        pass: "pick",
        surfaceSubset: false,
      });
      pass.end();
      expect(gpu.drawCalls.map((call) => call.indexCount)).toEqual([3, 6]);
      expect(gpu.buffers).toHaveLength(14);
    } finally {
      restore();
    }
  });
});
