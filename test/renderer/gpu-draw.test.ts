import { describe, expect, it } from "vitest";
import { createPart, MAX_PART_ID, type Part } from "../../src/geometry/part";
import { translation } from "../../src/math/mat4";
import {
  createDrawResources,
  destroyDrawResources,
  EMISSIVE_BYTE_OFFSET,
  encodeInstanceRecord,
  patchInstances,
  uploadPart,
  writeDrawOrder,
  writeEdgeOrder,
  writeNodeOrder,
  type DrawCallContext,
} from "../../src/renderer/gpu-draw";
import { drawBatches } from "../../src/renderer/gpu-batch";
import { beginColorPass, ensureColorTargets } from "../../src/renderer/gpu-pipelines";
import {
  ELEMENT_RECORD_STRIDE,
  HIGHLIGHT_HEADER,
  INITIAL_ELEMENT_HIGHLIGHTS,
} from "../../src/renderer/gpu-elements";
import { defaultStyle } from "../../src/renderer/gpu-support";
import type { DrawPipelines } from "../../src/renderer/gpu-pipelines";
import { fakeGpuDevice, installGpuGlobals } from "./fake-gpu";

const HIGHLIGHT_BUFFER_SIZE = HIGHLIGHT_HEADER + INITIAL_ELEMENT_HIGHLIGHTS * ELEMENT_RECORD_STRIDE;

const part: Part = createPart(1, {
  positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
  indices: new Uint32Array([0, 1, 2]),
  primitive: "triangles" as const,
});

const subsetPart: Part = createPart(2, {
  positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 0, 1, 1]),
  indices: new Uint32Array([0, 1, 2, 3, 4, 5]),
  primitive: "triangles" as const,
  facePickIds: new Uint32Array([1, 2]),
  faces: [
    {
      id: 0,
      elementId: 1,
      faceIndex: 0,
      key: "0,1,2",
      nodeIds: [0, 1, 2],
      neighborElementIds: [],
    },
    {
      id: 1,
      elementId: 1,
      faceIndex: 1,
      key: "3,4,5",
      nodeIds: [3, 4, 5],
      neighborElementIds: [],
    },
  ],
  faceSubset: { faceIds: [1] },
});

const logicalPointPart: Part = createPart(3, {
  positions: new Float32Array([0, 0, 0, 1, 1, 1]),
  indices: new Uint32Array([0, 1]),
  primitive: "points",
  elements: [
    { id: 10, primitiveStart: 0, primitiveCount: 1 },
    { id: 11, primitiveStart: 1, primitiveCount: 1 },
  ],
  nodePickIds: new Uint32Array([1, 2]),
});

const nodePart: Part = createPart(4, {
  positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
  indices: new Uint32Array([0, 1, 2]),
  primitive: "triangles",
  nodePositions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
  nodePickIds: new Uint32Array([1, 2, 3]),
});

function record(x: number): ArrayBuffer {
  return encodeInstanceRecord(translation(x, 0, 0), defaultStyle, 1);
}

/** A record whose bytes are all non-zero so every byte diffs against zeros. */
function denseRecord(fill: number): ArrayBuffer {
  const data = new Uint8Array(96);
  data.fill(fill);
  return data.buffer;
}

function instanceWrites(gpu: ReturnType<typeof fakeGpuDevice>) {
  return gpu.writes.filter((write) => write.bytes.byteLength !== 64);
}

function writeRanges(gpu: ReturnType<typeof fakeGpuDevice>, start: number) {
  return instanceWrites(gpu)
    .slice(start)
    .map((write) => [write.offset, write.bytes.byteLength] as const);
}

function drawContext(): DrawCallContext {
  return {
    frameBindGroup: {} as GPUBindGroup,
    instanceLayout: {} as GPUBindGroupLayout,
    parts: new Map([[part.id, part]]),
    pipelines: {} as DrawPipelines,
  };
}

describe("GPU draw path", () => {
  it("uploads part geometry once and caches it", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const draw = createDrawResources(gpu.device);
      const first = uploadPart(draw, part);
      const second = uploadPart(draw, part);
      expect(second).toBe(first);
      expect(second.indexCount).toBe(3);
      expect(gpu.buffers).toHaveLength(9);
      expect(gpu.buffers[0]?.size).toBe(36);
      expect(gpu.buffers[1]?.size).toBe(12);
      expect(gpu.buffers[2]?.size).toBe(4);
      expect(gpu.buffers[3]?.size).toBe(12);
      expect(gpu.buffers[4]?.size).toBe(104);
      expect(gpu.buffers[5]?.size).toBe(104);
      expect(gpu.buffers[6]?.size).toBe(72);
      expect(gpu.buffers[7]?.size).toBe(24);
      expect(gpu.buffers[8]?.size).toBe(24);
    } finally {
      restore();
    }
  });

  it("draws a face subset through compact indices and expanded edge endpoints", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const draw = createDrawResources(gpu.device);
      const resource = uploadPart(draw, subsetPart);
      expect(resource.indexCount).toBe(6);
      expect(resource.subsetIndexCount).toBe(3);
      expect(resource.subsetEdgeIndexCount).toBe(6);
      expect(resource.subsetIndexBuffer).toBeDefined();
      expect(resource.subsetEdgeIndexBuffer).toBeDefined();
      expect(gpu.buffers).toHaveLength(15);

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
      pass.end();
      expect(gpu.drawCalls).toEqual([{ indexCount: 3, instanceCount: 1 }]);
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
      expect(gpu.buffers[0]?.size).toBe(96);
      expect(gpu.buffers[1]?.size).toBe(48);
      expect(gpu.buffers[2]?.size).toBe(8);
      expect(gpu.buffers[3]?.size).toBe(32);

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

  it("encodes transform, style, emissive, and stable pick id into a record", () => {
    const data = encodeInstanceRecord(
      translation(1, 2, 3),
      {
        color: { r: 1, g: 0.5, b: 0.25, a: 1 },
        emissive: 0.4,
        opacity: 0.5,
        edge: false,
        nodes: false,
      },
      7,
    );
    const floats = new Float32Array(data);
    const ids = new Uint32Array(data);
    expect(floats[12]).toBe(1);
    expect(floats[13]).toBe(2);
    expect(floats[14]).toBe(3);
    expect(floats[16]).toBe(1);
    expect(floats[19]).toBeCloseTo(0.5);
    expect(ids[20]).toBe(7);
    expect(new Float32Array(data, EMISSIVE_BYTE_OFFSET, 1)[0]).toBeCloseTo(0.4);
  });

  it("preserves the maximum direct-u32 part identity in instance storage", () => {
    const ids = new Uint32Array(
      encodeInstanceRecord(translation(0, 0, 0), defaultStyle, MAX_PART_ID),
    );
    expect(ids[20]).toBe(MAX_PART_ID);
  });

  it("writes only the changed subranges of patched slots", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const draw = createDrawResources(gpu.device);
      patchInstances(draw, part.id, [{ slot: 0, data: record(1) }]);
      const afterInitial = gpu.writes.length;
      patchInstances(draw, part.id, [{ slot: 0, data: record(1) }]);
      expect(gpu.writes.length).toBe(afterInitial);
      patchInstances(draw, part.id, [{ slot: 0, data: record(9) }]);
      expect(writeRanges(gpu, afterInitial)).toEqual([[48, 4]]);
    } finally {
      restore();
    }
  });

  it("addresses patched slots at their record offsets", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const draw = createDrawResources(gpu.device);
      patchInstances(draw, part.id, [{ slot: 2, data: record(1) }]);
      const afterInitial = gpu.writes.length;
      patchInstances(draw, part.id, [{ slot: 2, data: record(9) }]);
      expect(writeRanges(gpu, afterInitial)).toEqual([[2 * 96 + 48, 4]]);
    } finally {
      restore();
    }
  });

  it("patches only the emissive float when only emissive changes", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const draw = createDrawResources(gpu.device);
      const styled = (emissive: number) =>
        encodeInstanceRecord(
          translation(1, 0, 0),
          {
            color: { r: 0.23, g: 0.51, b: 0.96, a: 1 },
            emissive,
            opacity: 1,
            edge: false,
            nodes: false,
          },
          1,
        );
      patchInstances(draw, part.id, [{ slot: 0, data: styled(0) }]);
      const afterInitial = gpu.writes.length;
      patchInstances(draw, part.id, [{ slot: 0, data: styled(0.5) }]);
      expect(writeRanges(gpu, afterInitial)).toEqual([[EMISSIVE_BYTE_OFFSET, 4]]);
    } finally {
      restore();
    }
  });

  it("coalesces adjacent changed slots into one contiguous write", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const draw = createDrawResources(gpu.device);
      patchInstances(draw, part.id, [
        { slot: 0, data: denseRecord(1) },
        { slot: 1, data: denseRecord(1) },
      ]);
      patchInstances(draw, part.id, [{ slot: 0, data: denseRecord(2) }]);
      const writes = instanceWrites(gpu);
      expect(writes[0]?.offset).toBe(0);
      expect(writes[0]?.bytes.byteLength).toBe(192);
      expect(writes[1]?.offset).toBe(0);
      expect(writes[1]?.bytes.byteLength).toBe(96);
    } finally {
      restore();
    }
  });

  it("grows the per-part buffers to cover patched slots", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const draw = createDrawResources(gpu.device);
      patchInstances(draw, part.id, [{ slot: 5, data: record(1) }]);
      expect(gpu.buffers).toHaveLength(8);
      expect(gpu.buffers[0]?.size).toBe(6 * 96);
      expect(gpu.buffers[1]?.size).toBe(6 * 4);
      expect(gpu.buffers[2]?.size).toBe(6 * 4);
      expect(gpu.buffers[3]?.size).toBe(6 * 4);
      expect(gpu.buffers[4]?.size).toBe(6 * 4);
      expect(gpu.buffers[5]?.size).toBe(6 * 4);
      expect(gpu.buffers[6]?.size).toBe(6 * 4);
      expect(gpu.buffers[7]?.size).toBe(HIGHLIGHT_BUFFER_SIZE);
      patchInstances(draw, part.id, [{ slot: 10, data: record(2) }]);
      expect(gpu.buffers[8]?.size).toBe(12 * 96);
      expect(gpu.buffers[9]?.size).toBe(12 * 4);
      expect(gpu.buffers[10]?.size).toBe(12 * 4);
      expect(gpu.buffers[11]?.size).toBe(12 * 4);
    } finally {
      restore();
    }
  });

  it("rewrites only the changed draw-order entries", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const draw = createDrawResources(gpu.device);
      writeDrawOrder(draw, part.id, new Uint32Array([0, 1, 2]));
      const afterInitial = gpu.writes.length;
      writeDrawOrder(draw, part.id, new Uint32Array([0, 2]));
      expect(writeRanges(gpu, afterInitial)).toEqual([[4, 8]]);
    } finally {
      restore();
    }
  });

  it("writes the edge overlay order to its own buffer, diffed like the surface order", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const draw = createDrawResources(gpu.device);
      writeEdgeOrder(draw, part.id, new Uint32Array([0, 1, 2]));
      const afterInitial = gpu.writes.length;
      writeEdgeOrder(draw, part.id, new Uint32Array([0, 1, 2]));
      expect(gpu.writes.length).toBe(afterInitial);
      writeEdgeOrder(draw, part.id, new Uint32Array([0, 2]));
      expect(writeRanges(gpu, afterInitial)).toEqual([[4, 8]]);
    } finally {
      restore();
    }
  });

  it("writes the node annotation order to its own buffer", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const draw = createDrawResources(gpu.device);
      writeNodeOrder(draw, part.id, new Uint32Array([0, 1, 2]));
      const afterInitial = gpu.writes.length;
      writeNodeOrder(draw, part.id, new Uint32Array([0, 1, 2]));
      expect(gpu.writes.length).toBe(afterInitial);
      writeNodeOrder(draw, part.id, new Uint32Array([0, 2]));
      expect(writeRanges(gpu, afterInitial)).toEqual([[4, 8]]);
    } finally {
      restore();
    }
  });

  it("draws the overlay pass through the edge order and edge index buffers", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const draw = createDrawResources(gpu.device);
      patchInstances(draw, part.id, [
        { slot: 0, data: record(0) },
        { slot: 1, data: record(1) },
        { slot: 2, data: record(2) },
      ]);
      writeDrawOrder(draw, part.id, new Uint32Array([0, 1, 2]));
      writeEdgeOrder(draw, part.id, new Uint32Array([0, 2]));
      const encoder = gpu.device.createCommandEncoder();
      const pass = beginColorPass(
        encoder,
        {} as GPUTextureView,
        {} as GPUTextureView,
        {} as GPUTextureView,
      );
      drawBatches(pass, draw, drawContext(), [{ partId: part.id, instanceCount: 3 }], {
        kind: "surface",
        pass: "color",
      });
      drawBatches(pass, draw, drawContext(), [{ partId: part.id, instanceCount: 2 }], {
        kind: "edge",
        pipeline: {} as GPURenderPipeline,
      });
      pass.end();
      expect(gpu.drawCalls).toEqual([
        { indexCount: 3, instanceCount: 3 },
        { indexCount: 6, instanceCount: 2 },
      ]);
      expect(gpu.bindGroupCreations).toBe(2);
    } finally {
      restore();
    }
  });

  it("draws node annotations through the node order buffer", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const draw = createDrawResources(gpu.device);
      patchInstances(draw, nodePart.id, [
        { slot: 0, data: record(0) },
        { slot: 1, data: record(1) },
      ]);
      writeNodeOrder(draw, nodePart.id, new Uint32Array([0, 1]));
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
        { ...drawContext(), parts: new Map([[nodePart.id, nodePart]]) },
        [{ partId: nodePart.id, instanceCount: 2 }],
        { kind: "nodes", pipeline: {} as GPURenderPipeline },
      );
      pass.end();
      expect(gpu.drawCalls).toEqual([{ indexCount: 18, instanceCount: 2 }]);
      expect(gpu.bindGroupCreations).toBe(1);
    } finally {
      restore();
    }
  });

  it("skips overlay batches that have no edge geometry", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const draw = createDrawResources(gpu.device);
      const linePart = createPart(4, {
        positions: new Float32Array([0, 0, 0, 1, 0, 0]),
        indices: new Uint32Array([0, 1]),
        primitive: "lines",
      });
      patchInstances(draw, linePart.id, [{ slot: 0, data: record(0) }]);
      writeEdgeOrder(draw, linePart.id, new Uint32Array([0]));
      const encoder = gpu.device.createCommandEncoder();
      const pass = beginColorPass(
        encoder,
        {} as GPUTextureView,
        {} as GPUTextureView,
        {} as GPUTextureView,
      );
      const context = { ...drawContext(), parts: new Map([[linePart.id, linePart]]) };
      drawBatches(pass, draw, context, [{ partId: linePart.id, instanceCount: 1 }], {
        kind: "edge",
        pipeline: {} as GPURenderPipeline,
      });
      pass.end();
      expect(gpu.drawCalls).toEqual([]);
      expect(gpu.bindGroupCreations).toBe(0);
    } finally {
      restore();
    }
  });

  it("draws one instanced batch per part from its storage buffers", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const draw = createDrawResources(gpu.device);
      patchInstances(draw, part.id, [
        { slot: 0, data: record(0) },
        { slot: 1, data: record(1) },
      ]);
      writeDrawOrder(draw, part.id, new Uint32Array([0, 1]));
      const encoder = gpu.device.createCommandEncoder();
      const pass = beginColorPass(
        encoder,
        {} as GPUTextureView,
        {} as GPUTextureView,
        {} as GPUTextureView,
      );
      drawBatches(pass, draw, drawContext(), [{ partId: part.id, instanceCount: 2 }], {
        kind: "surface",
        pass: "color",
      });
      pass.end();
      expect(gpu.drawCalls).toEqual([{ indexCount: 3, instanceCount: 2 }]);
    } finally {
      restore();
    }
  });

  it("switches pipelines to match each part's primitive topology", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const draw = createDrawResources(gpu.device);
      const trianglePart = part;
      const linePart = createPart(2, {
        positions: new Float32Array([0, 0, 0, 1, 0, 0]),
        indices: new Uint32Array([0, 1]),
        primitive: "lines",
      });
      const pointPart = createPart(3, {
        positions: new Float32Array([0, 0, 0, 1, 0, 0]),
        indices: new Uint32Array([0, 1]),
        primitive: "points",
      });
      const pipelines = {
        trianglesColor: { name: "triangles-color" },
        linesColor: { name: "lines-color" },
        pointsColor: { name: "points-color" },
      } as unknown as DrawPipelines;
      for (const item of [trianglePart, linePart, pointPart]) {
        patchInstances(draw, item.id, [{ slot: 0, data: record(0) }]);
        writeDrawOrder(draw, item.id, new Uint32Array([0]));
      }
      const context: DrawCallContext = {
        frameBindGroup: {} as GPUBindGroup,
        instanceLayout: {} as GPUBindGroupLayout,
        parts: new Map([
          [trianglePart.id, trianglePart],
          [linePart.id, linePart],
          [pointPart.id, pointPart],
        ]),
        pipelines,
      };
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
        context,
        [
          { partId: trianglePart.id, instanceCount: 1 },
          { partId: linePart.id, instanceCount: 1 },
          { partId: pointPart.id, instanceCount: 1 },
        ],
        { kind: "surface", pass: "color" },
      );
      pass.end();
      expect(gpu.pipelineCalls).toEqual([
        pipelines.trianglesColor,
        pipelines.linesColor,
        pipelines.pointsColor,
      ]);
      expect(gpu.drawCalls).toHaveLength(3);
    } finally {
      restore();
    }
  });

  it("reuses one bind group per storage across frames", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const draw = createDrawResources(gpu.device);
      patchInstances(draw, part.id, [{ slot: 0, data: record(0) }]);
      writeDrawOrder(draw, part.id, new Uint32Array([0]));
      const calls = [{ partId: part.id, instanceCount: 1 }];
      for (let frame = 0; frame < 3; frame += 1) {
        const encoder = gpu.device.createCommandEncoder();
        const pass = beginColorPass(
          encoder,
          {} as GPUTextureView,
          {} as GPUTextureView,
          {} as GPUTextureView,
        );
        drawBatches(pass, draw, drawContext(), calls, { kind: "surface", pass: "color" });
        pass.end();
      }
      expect(gpu.bindGroupCreations).toBe(1);
      expect(gpu.drawCalls).toHaveLength(3);
    } finally {
      restore();
    }
  });

  it("creates a new bind group when the storage grows", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const draw = createDrawResources(gpu.device);
      patchInstances(draw, part.id, [{ slot: 0, data: record(0) }]);
      writeDrawOrder(draw, part.id, new Uint32Array([0]));
      const encoder = gpu.device.createCommandEncoder();
      const pass = beginColorPass(
        encoder,
        {} as GPUTextureView,
        {} as GPUTextureView,
        {} as GPUTextureView,
      );
      drawBatches(pass, draw, drawContext(), [{ partId: part.id, instanceCount: 1 }], {
        kind: "surface",
        pass: "color",
      });
      pass.end();
      patchInstances(draw, part.id, [
        { slot: 0, data: record(0) },
        { slot: 1, data: record(1) },
        { slot: 2, data: record(2) },
      ]);
      writeDrawOrder(draw, part.id, new Uint32Array([0, 1, 2]));
      const encoder2 = gpu.device.createCommandEncoder();
      const pass2 = beginColorPass(
        encoder2,
        {} as GPUTextureView,
        {} as GPUTextureView,
        {} as GPUTextureView,
      );
      drawBatches(pass2, draw, drawContext(), [{ partId: part.id, instanceCount: 3 }], {
        kind: "surface",
        pass: "color",
      });
      pass2.end();
      expect(gpu.bindGroupCreations).toBe(2);
    } finally {
      restore();
    }
  });

  it("reuses multisampled color targets and only resizes when the canvas size changes", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const draw = createDrawResources(gpu.device);
      const first = ensureColorTargets(draw, 800, 600, "bgra8unorm", "depth24plus-stencil8");
      const second = ensureColorTargets(draw, 800, 600, "bgra8unorm", "depth24plus-stencil8");
      expect(second.color).toBe(first.color);
      expect(second.depth).toBe(first.depth);
      expect(gpu.textureCreations).toBe(7);
      expect(gpu.textures[0]?.descriptor.sampleCount).toBe(4);
      expect(gpu.textures[1]?.descriptor.sampleCount).toBeUndefined();
      expect(gpu.textures[1]?.descriptor.usage).toBe(
        GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      );
      expect(gpu.textures[2]?.descriptor.sampleCount).toBe(4);
      expect(gpu.textures[3]?.descriptor.sampleCount).toBeUndefined();
      expect(gpu.textures[4]?.descriptor.sampleCount).toBe(4);
      expect(gpu.textures[5]?.descriptor.sampleCount).toBeUndefined();
      expect(gpu.textures[6]?.descriptor.sampleCount).toBe(4);
      draw.targets.compositeBindGroup = {} as GPUBindGroup;
      const resized = ensureColorTargets(draw, 400, 300, "bgra8unorm", "depth24plus-stencil8");
      expect(resized.depth).not.toBe(first.depth);
      expect(gpu.textureCreations).toBe(14);
      expect(gpu.textures[0]?.destroyed).toBe(true);
      expect(gpu.textures[1]?.destroyed).toBe(true);
      expect(draw.targets.compositeBindGroup).toBeUndefined();
      destroyDrawResources(draw);
      destroyDrawResources(draw);
      expect(gpu.textures.slice(7).every((texture) => texture.destroyed)).toBe(true);
      expect(gpu.textures.every((texture) => texture.destroyCount === 1)).toBe(true);
    } finally {
      restore();
    }
  });

  it("cleans partial visible-target allocation without publishing half-state", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice({ textureCreationErrorAt: 4 });
      const draw = createDrawResources(gpu.device);

      expect(() => {
        ensureColorTargets(draw, 800, 600, "bgra8unorm", "depth24plus-stencil8");
      }).toThrow("fake texture allocation failed at 4");
      expect(gpu.textureCreations).toBe(3);
      expect(gpu.textures.every((texture) => texture.destroyCount === 1)).toBe(true);
      expect(draw.targets.msaaColorTexture).toBeUndefined();
      expect(draw.targets.opaqueColorTexture).toBeUndefined();
      expect(draw.targets.depthTexture).toBeUndefined();
      expect(draw.targets.depthWidth).toBe(0);
      expect(draw.targets.depthHeight).toBe(0);
      expect(draw.targets.compositeBindGroup).toBeUndefined();
    } finally {
      restore();
    }
  });
});
