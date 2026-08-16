import { describe, expect, it } from "vitest";
import { createPart, MAX_PART_ID, type Part } from "../../src/geometry/part";
import { translation } from "../../src/math/mat4";
import {
  createDrawResources,
  destroyDrawResources,
  EMISSIVE_BYTE_OFFSET,
  encodeInstanceRecord,
  INSTANCE_EMPHASIS_FLAG,
  INSTANCE_SELECTED_FLAG,
  patchInstances,
  uploadPart,
  ensureEdgePickResources,
  writeDrawOrder,
  writeEdgeOrder,
  writeNodeOrder,
  writeSelectionOrder,
  type DrawCallContext,
} from "../../src/renderer/resources/gpu-draw";
import { drawBatches } from "../../src/renderer/core/gpu-batch";
import { ensureColorTargets } from "../../src/renderer/core/gpu-pipelines";
import { beginColorPass } from "../../src/renderer/gpu-passes";
import {
  ELEMENT_RECORD_STRIDE,
  HIGHLIGHT_HEADER,
  INITIAL_ELEMENT_HIGHLIGHTS,
} from "../../src/renderer/resources/gpu-elements";
import { defaultStyle } from "../../src/renderer/resources/gpu-support";
import type { DrawPipelines } from "../../src/renderer/core/gpu-pipelines";
import { fakeGpuDevice, installGpuGlobals } from "./fake-gpu";
import { syncInstanceEmphasisAdmission } from "../../src/renderer/selection/gpu-instance-emphasis";
import type { DenseElementSelections } from "../../src/renderer/selection/gpu-element-selection";

const HIGHLIGHT_BUFFER_SIZE = HIGHLIGHT_HEADER + INITIAL_ELEMENT_HIGHLIGHTS * ELEMENT_RECORD_STRIDE;

const part: Part = createPart(1, {
  geometries: [
    {
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      indices: new Uint32Array([0, 1, 2]),
      primitive: "triangles" as const,
    },
  ],
});

const authoredEdgePart: Part = createPart(5, {
  geometries: [
    {
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      indices: new Uint32Array([0, 1, 2]),
      primitive: "triangles" as const,
      nodePickIds: new Uint32Array([1, 2, 3]),
      faces: [
        {
          elementId: 4,
          faceIndex: 0,
          primitiveStart: 0,
          primitiveCount: 1,
          key: "face",
          nodeIds: [0, 1, 2],
          neighborElementIds: [],
        },
      ],
      edges: [
        {
          key: "0,1",
          nodeIds: [0, 1],
          incidentElementIds: [4],
          faceRefs: [{ elementId: 4, faceIndex: 0 }],
        },
        {
          key: "0,2",
          nodeIds: [0, 2],
          incidentElementIds: [4],
          faceRefs: [{ elementId: 4, faceIndex: 0 }],
        },
        {
          key: "1,2",
          nodeIds: [1, 2],
          incidentElementIds: [4],
          faceRefs: [{ elementId: 4, faceIndex: 0 }],
        },
      ],
    },
  ],
  elements: [
    { id: 4, primitiveRanges: [{ primitive: "triangles", primitiveStart: 0, primitiveCount: 1 }] },
  ],
});

const subsetPart: Part = createPart(2, {
  geometries: [
    {
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 0, 1, 1]),
      indices: new Uint32Array([0, 1, 2, 3, 4, 5]),
      primitive: "triangles" as const,
      faces: [
        {
          elementId: 1,
          faceIndex: 0,
          primitiveStart: 0,
          primitiveCount: 1,
          key: "0,1,2",
          nodeIds: [0, 1, 2],
          neighborElementIds: [],
        },
        {
          elementId: 1,
          faceIndex: 1,
          primitiveStart: 1,
          primitiveCount: 1,
          key: "3,4,5",
          nodeIds: [3, 4, 5],
          neighborElementIds: [],
        },
      ],
      faceSubset: { faceIds: [{ elementId: 1, faceIndex: 1 }] },
    },
  ],
});

const logicalPointPart: Part = createPart(3, {
  geometries: [
    {
      positions: new Float32Array([0, 0, 0, 1, 1, 1]),
      indices: new Uint32Array([0, 1]),
      primitive: "points",
      nodePickIds: new Uint32Array([1, 2]),
    },
  ],
  elements: [
    { id: 10, primitiveRanges: [{ primitive: "points", primitiveStart: 0, primitiveCount: 1 }] },
    { id: 11, primitiveRanges: [{ primitive: "points", primitiveStart: 1, primitiveCount: 1 }] },
  ],
});

const nodePart: Part = createPart(4, {
  geometries: [
    {
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      indices: new Uint32Array([0, 1, 2]),
      primitive: "triangles",
      nodePickIds: new Uint32Array([1, 2, 3]),
    },
  ],
  nodePositions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
});

const mixedPart: Part = createPart(6, {
  geometries: [
    {
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      indices: new Uint32Array([0, 1, 2]),
      primitive: "triangles",
    },
    {
      positions: new Float32Array([0, 0, 0, 1, 1, 1]),
      indices: new Uint32Array([0, 1]),
      primitive: "lines",
    },
    {
      positions: new Float32Array([0.5, 0.5, 0.5]),
      indices: new Uint32Array([0]),
      primitive: "points",
    },
  ],
  elements: [
    { id: 1, primitiveRanges: [{ primitive: "triangles", primitiveStart: 0, primitiveCount: 1 }] },
    { id: 2, primitiveRanges: [{ primitive: "lines", primitiveStart: 0, primitiveCount: 1 }] },
    { id: 3, primitiveRanges: [{ primitive: "points", primitiveStart: 0, primitiveCount: 1 }] },
  ],
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
    resultColors: undefined,
  };
}

describe("GPU draw path", () => {
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
      expect(gpu.buffers).toHaveLength(5);
      expect(gpu.buffers[0]?.size).toBe(68);
      expect(gpu.buffers[1]?.size).toBe(12);
      expect(gpu.buffers[2]?.size).toBe(4);
      expect(gpu.buffers[3]?.size).toBe(12);
      expect(gpu.buffers[4]?.size).toBe(56);
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
      expect(gpu.buffers).toHaveLength(9);

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

  it("draws complete geometry for selection when ordinary rendering uses a face subset", () => {
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
        { kind: "surface", pass: "selection-visible" },
      );
      pass.end();
      expect(gpu.drawCalls).toEqual([{ indexCount: 6, instanceCount: 1 }]);
    } finally {
      restore();
    }
  });

  it("draws selected primitive ranges with the selection-order offset", () => {
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
        { kind: "surface", pass: "selection-visible" },
      );
      pass.end();
      expect(gpu.drawCalls).toEqual([
        { indexCount: 3, instanceCount: 1, firstIndex: 3, firstInstance: 1 },
      ]);
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
      expect(gpu.buffers[0]?.size).toBe(160);
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
        lineWidthPixels: 7,
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
    expect(floats[23]).toBeCloseTo(7);
  });

  it("preserves the maximum direct-u32 part identity in instance storage", () => {
    const ids = new Uint32Array(
      encodeInstanceRecord(translation(0, 0, 0), defaultStyle, MAX_PART_ID),
    );
    expect(ids[20]).toBe(MAX_PART_ID);
  });

  it("writes one complete record for a changed slot", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const draw = createDrawResources(gpu.device);
      patchInstances(draw, part.id, [{ slot: 0, data: record(1) }]);
      const afterInitial = gpu.writes.length;
      patchInstances(draw, part.id, [{ slot: 0, data: record(1) }]);
      expect(gpu.writes.length).toBe(afterInitial);
      patchInstances(draw, part.id, [{ slot: 0, data: record(9) }]);
      expect(writeRanges(gpu, afterInitial)).toEqual([[0, 96]]);
    } finally {
      restore();
    }
  });

  it("admits only occurrences with primitive emphasis and clears stale admission", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const draw = createDrawResources(gpu.device);
      patchInstances(draw, part.id, [
        { slot: 0, data: record(0) },
        { slot: 1, data: record(1) },
      ]);
      const update = (slot: number) => ({
        slot,
        elementPickId: 1,
        facePickId: 0,
        nodePickId: 0,
        style: defaultStyle,
      });
      const emphasized = new Map([[part.id, [update(1)]]]);
      syncInstanceEmphasisAdmission(draw, emphasized, new Set([part.id]));
      const storage = draw.storages.get(part.id);
      expect(storage).toBeDefined();
      const flags = new Uint32Array(storage?.data ?? new ArrayBuffer(0));
      expect(flags[22]).toBe(0);
      expect(flags[46]).toBe(INSTANCE_EMPHASIS_FLAG);
      const afterAdmission = gpu.writes.length;
      syncInstanceEmphasisAdmission(draw, emphasized, new Set([part.id]));
      expect(gpu.writes.length).toBe(afterAdmission);
      syncInstanceEmphasisAdmission(draw, new Map(), new Set([part.id]));
      expect(new Uint32Array(storage?.data ?? new ArrayBuffer(0))[46]).toBe(0);
    } finally {
      restore();
    }
  });

  it("preserves admission when an instance style record is patched", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const draw = createDrawResources(gpu.device);
      patchInstances(draw, part.id, [{ slot: 0, data: record(0) }]);
      const update = {
        slot: 0,
        elementPickId: 1,
        facePickId: 0,
        nodePickId: 0,
        style: defaultStyle,
      };
      syncInstanceEmphasisAdmission(draw, new Map([[part.id, [update]]]), new Set([part.id]));
      patchInstances(draw, part.id, [
        {
          slot: 0,
          data: encodeInstanceRecord(translation(2, 0, 0), defaultStyle, 1, true),
        },
      ]);
      const flags = new Uint32Array(draw.storages.get(part.id)?.data ?? new ArrayBuffer(0));
      expect(flags[22]).toBe(INSTANCE_SELECTED_FLAG | INSTANCE_EMPHASIS_FLAG);
    } finally {
      restore();
    }
  });

  it("admits dense selected occurrences without sparse emphasis records", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const draw = createDrawResources(gpu.device);
      patchInstances(draw, part.id, [{ slot: 0, data: record(0) }]);
      const denseSelections: DenseElementSelections = new Map([
        [part.id, { elementCount: 2, occurrences: [{ slot: 0, ordinals: [1] }] }],
      ]);
      syncInstanceEmphasisAdmission(draw, new Map(), new Set([part.id]), denseSelections);
      const flags = new Uint32Array(draw.storages.get(part.id)?.data ?? new ArrayBuffer(0));
      expect(flags[22]).toBe(INSTANCE_EMPHASIS_FLAG);
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
      expect(writeRanges(gpu, afterInitial)).toEqual([[2 * 96, 96]]);
    } finally {
      restore();
    }
  });

  it("writes the complete record when only emissive changes", () => {
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
            lineWidthPixels: 2,
            edge: false,
            nodes: false,
          },
          1,
        );
      patchInstances(draw, part.id, [{ slot: 0, data: styled(0) }]);
      const afterInitial = gpu.writes.length;
      patchInstances(draw, part.id, [{ slot: 0, data: styled(0.5) }]);
      expect(writeRanges(gpu, afterInitial)).toEqual([[0, 96]]);
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

  it("keeps distant changed slots in separate bounded writes", () => {
    const restore = installGpuGlobals();
    try {
      const coalescedGpu = fakeGpuDevice();
      const coalescedDraw = createDrawResources(coalescedGpu.device);
      patchInstances(coalescedDraw, part.id, [
        { slot: 0, data: denseRecord(1) },
        { slot: 3, data: denseRecord(1) },
      ]);
      expect(
        instanceWrites(coalescedGpu).map((write) => [write.offset, write.bytes.byteLength]),
      ).toEqual([[0, 4 * 96]]);

      const sparseGpu = fakeGpuDevice();
      const sparseDraw = createDrawResources(sparseGpu.device);
      patchInstances(sparseDraw, part.id, [
        { slot: 0, data: denseRecord(1) },
        { slot: 4, data: denseRecord(1) },
      ]);
      expect(sparseGpu.writes.map((write) => [write.offset, write.bytes.byteLength])).toEqual([
        [0, 96],
        [4 * 96, 96],
      ]);
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
      const resource = uploadPart(draw, part);
      expect(resource.edge).toBeUndefined();
      expect(gpu.buffers).toHaveLength(5);
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
      const buffersBeforeEdge = gpu.buffers.length;
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
      expect(resource.edge).toBeDefined();
      expect(gpu.buffers).toHaveLength(buffersBeforeEdge + 4);
      const buffersAfterFirstEdge = gpu.buffers.length;
      const encoder2 = gpu.device.createCommandEncoder();
      const pass2 = beginColorPass(
        encoder2,
        {} as GPUTextureView,
        {} as GPUTextureView,
        {} as GPUTextureView,
      );
      drawBatches(pass2, draw, drawContext(), [{ partId: part.id, instanceCount: 2 }], {
        kind: "edge",
        pipeline: {} as GPURenderPipeline,
      });
      pass2.end();
      expect(gpu.buffers).toHaveLength(buffersAfterFirstEdge);
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
      drawBatches(
        pass,
        draw,
        { ...drawContext(), parts: new Map([[nodePart.id, nodePart]]) },
        [{ partId: nodePart.id, instanceCount: 2 }],
        { kind: "nodes", pipeline: {} as GPURenderPipeline },
      );
      pass.end();
      expect(gpu.drawCalls).toEqual([
        { indexCount: 18, instanceCount: 2 },
        { indexCount: 18, instanceCount: 2 },
      ]);
      expect(gpu.bindGroupCreations).toBe(1);
    } finally {
      restore();
    }
  });

  it("binds node annotations to their own node-id table after an elemental-result surface draw", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const draw = createDrawResources(gpu.device);
      patchInstances(draw, nodePart.id, [{ slot: 0, data: record(0) }]);
      writeDrawOrder(draw, nodePart.id, new Uint32Array([0]));
      writeNodeOrder(draw, nodePart.id, new Uint32Array([0]));
      const context = { ...drawContext(), parts: new Map([[nodePart.id, nodePart]]) };
      const encoder = gpu.device.createCommandEncoder();
      const pass = beginColorPass(
        encoder,
        {} as GPUTextureView,
        {} as GPUTextureView,
        {} as GPUTextureView,
      );
      drawBatches(pass, draw, context, [{ partId: nodePart.id, instanceCount: 1 }], {
        kind: "surface",
        pass: "color",
      });
      drawBatches(pass, draw, context, [{ partId: nodePart.id, instanceCount: 1 }], {
        kind: "nodes",
        pipeline: {} as GPURenderPipeline,
      });
      pass.end();
      expect(gpu.bindGroupCreations).toBe(2);
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
        geometries: [
          {
            positions: new Float32Array([0, 0, 0, 1, 0, 0]),
            indices: new Uint32Array([0, 1]),
            primitive: "lines",
          },
        ],
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
        geometries: [
          {
            positions: new Float32Array([0, 0, 0, 1, 0, 0]),
            indices: new Uint32Array([0, 1]),
            primitive: "lines",
          },
        ],
      });
      const pointPart = createPart(3, {
        geometries: [
          {
            positions: new Float32Array([0, 0, 0, 1, 0, 0]),
            indices: new Uint32Array([0, 1]),
            primitive: "points",
          },
        ],
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
        resultColors: undefined,
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
      const first = ensureColorTargets(draw, {
        width: 800,
        height: 600,
        colorFormat: "bgra8unorm",
        depthFormat: "depth24plus-stencil8",
      });
      const second = ensureColorTargets(draw, {
        width: 800,
        height: 600,
        colorFormat: "bgra8unorm",
        depthFormat: "depth24plus-stencil8",
      });
      expect(second.color).toBe(first.color);
      expect(second.depth).toBe(first.depth);
      expect(gpu.textureCreations).toBe(7);
      expect(gpu.textures[0]?.descriptor.sampleCount).toBe(4);
      expect(gpu.textures[1]?.descriptor.sampleCount).toBe(4);
      expect(gpu.textures[1]?.descriptor.usage).toBe(
        GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      );
      expect(gpu.textures[2]?.descriptor.sampleCount).toBeUndefined();
      expect(gpu.textures[3]?.descriptor.sampleCount).toBe(4);
      expect(gpu.textures[4]?.descriptor.sampleCount).toBeUndefined();
      expect(gpu.textures[5]?.descriptor.sampleCount).toBe(4);
      expect(gpu.textures[6]?.descriptor.sampleCount).toBeUndefined();
      draw.targets.compositeBindGroup = {} as GPUBindGroup;
      const resized = ensureColorTargets(draw, {
        width: 400,
        height: 300,
        colorFormat: "bgra8unorm",
        depthFormat: "depth24plus-stencil8",
      });
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

  it("allocates and releases weighted targets independently of base color and depth", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const draw = createDrawResources(gpu.device);
      const opaque = ensureColorTargets(draw, {
        width: 800,
        height: 600,
        colorFormat: "bgra8unorm",
        depthFormat: "depth24plus-stencil8",
        requiresTransparency: false,
      });
      expect(gpu.textureCreations).toBe(2);
      expect(opaque.opaqueColor).toBeUndefined();
      expect(opaque.accumulation).toBeUndefined();
      const weighted = ensureColorTargets(draw, {
        width: 800,
        height: 600,
        colorFormat: "bgra8unorm",
        depthFormat: "depth24plus-stencil8",
        requiresTransparency: true,
      });
      expect(gpu.textureCreations).toBe(7);
      expect(weighted.color).toBe(opaque.color);
      expect(weighted.depth).toBe(opaque.depth);
      expect(weighted.opaqueColor).toBeDefined();
      const released = ensureColorTargets(draw, {
        width: 800,
        height: 600,
        colorFormat: "bgra8unorm",
        depthFormat: "depth24plus-stencil8",
        requiresTransparency: false,
      });
      expect(gpu.textureCreations).toBe(7);
      expect(released.color).toBe(opaque.color);
      expect(released.opaqueColor).toBeUndefined();
      expect(gpu.textures.slice(2).every((texture) => texture.destroyed)).toBe(true);
      destroyDrawResources(draw);
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
        ensureColorTargets(draw, {
          width: 800,
          height: 600,
          colorFormat: "bgra8unorm",
          depthFormat: "depth24plus-stencil8",
        });
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
