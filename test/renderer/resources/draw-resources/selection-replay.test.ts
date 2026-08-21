import { describe, expect, it } from "vitest";
import type { GeometryFaces } from "@/geometry/part";
import {
  partSemanticGraph,
  registerPartSemanticGraph,
} from "@/geometry/semantic/part-semantic-graph";
import { selectionReplayResource } from "@/renderer/resources/draw-resources";
import {
  beginColorPass,
  createDrawResources,
  createPart,
  drawBatches,
  drawContext,
  fakeGpuDevice,
  installGpuGlobals,
  mixedSubsetPart,
  patchInstances,
  record,
  subsetPart,
  writeSelectionOrder,
} from "./support";

describe("compact subset selection replay", () => {
  it("replays a subset triangle leaf while preserving mixed primitive ranges", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const draw = createDrawResources(gpu.device);
      patchInstances(draw, mixedSubsetPart.id, [{ slot: 0, data: record(0) }]);
      writeSelectionOrder(draw, mixedSubsetPart.id, new Uint32Array([0]));
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
        { ...drawContext(), parts: new Map([[mixedSubsetPart.id, mixedSubsetPart]]) },
        [
          {
            partId: mixedSubsetPart.id,
            instanceCount: 1,
            selectionRanges: [
              { primitive: "triangles", firstIndex: 0, indexCount: 3 },
              { primitive: "lines", firstIndex: 0, indexCount: 6 },
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
        { indexCount: 6, instanceCount: 1 },
      ]);
      expect(
        draw.primitiveParts.get(mixedSubsetPart.id)?.get("triangles")?.fullVertexBuffer,
      ).toBeUndefined();
    } finally {
      restore();
    }
  });

  it("packs exact selected face, body, element, neighbor, primitive, and corner metadata", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const draw = createDrawResources(gpu.device);
      const part = interiorReplayPart();
      const geometry = part.geometries[0];
      if (geometry?.primitive !== "triangles") throw new Error("Triangle fixture missing");
      const replay = selectionReplayResource(draw, part, geometry, [
        { primitive: "triangles", firstIndex: 0, indexCount: 3 },
      ]);
      if (replay === undefined) throw new Error("Selection replay missing");

      const topology = writtenWords(gpu, replay.facePickIdsBuffer);
      expect(Array.from(topology.subarray(0, 5))).toEqual([1, 1, 0, 1, 1]);
      expect(Array.from(topology.subarray(5, 10))).toEqual([1, 2, 3, 11, 21]);
      expect(Array.from(topology.subarray(12, 14))).toEqual([1, 2]);
      expect(topology[14]).toBe(3);
      expect(Array.from(topology.subarray(15, 18))).toEqual([0, 0, 0]);
      expect(Array.from(topology.subarray(18, 21))).toEqual([0, 1, 2]);
      expect(Array.from(writtenWords(gpu, replay.nodePickIdsBuffer))).toEqual([101, 102, 103]);
    } finally {
      restore();
    }
  });

  it("keeps sparse replay work bounded by selection size on a three-million-face source", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const draw = createDrawResources(gpu.device);
      const { part, geometry, lookupCount } = syntheticLargePart();
      const replay = selectionReplayResource(draw, part, geometry, [
        { primitive: "triangles", firstIndex: 0, indexCount: 3 },
      ]);
      if (replay === undefined) throw new Error("Selection replay missing");

      expect(lookupCount()).toBeLessThanOrEqual(23);
      const resources = new Set([
        replay.vertexBuffer,
        replay.indexBuffer,
        replay.nodePickIdsBuffer,
        replay.facePickIdsBuffer,
      ]);
      expect(
        gpu.writes
          .filter((write) => resources.has(write.buffer))
          .map((write) => write.bytes.length),
      ).toEqual([36, 80, 12, 12]);
    } finally {
      restore();
    }
  });

  it("destroys every partial buffer after repeated replay allocation failures", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice({ maxStorageBufferBindingSize: 64 });
      const draw = createDrawResources(gpu.device);
      const geometry = subsetPart.geometries[0];
      if (geometry?.primitive !== "triangles") throw new Error("Triangle fixture missing");
      const baseline = gpu.buffers.length;
      const allocate = () =>
        selectionReplayResource(draw, subsetPart, geometry, [
          { primitive: "triangles", firstIndex: 0, indexCount: 3 },
        ]);

      expect(allocate).toThrow("80 bytes exceeds device maxStorageBufferBindingSize 64");
      expect(allocate).toThrow("80 bytes exceeds device maxStorageBufferBindingSize 64");
      const attempts = gpu.buffers.slice(baseline);
      expect(attempts).toHaveLength(2);
      expect(attempts.every((buffer) => buffer.destroyed && buffer.destroyCount === 1)).toBe(true);
      expect(draw.selectionReplays.has(subsetPart.id)).toBe(false);
    } finally {
      restore();
    }
  });
});

function interiorReplayPart() {
  return createPart(8, {
    geometries: [
      {
        primitive: "triangles",
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 0, 1, 1]),
        indices: new Uint32Array([0, 1, 2, 3, 4, 5]),
        nodePickIds: new Uint32Array([101, 102, 103, 104, 105, 106]),
        faces: [face(10, 0, 0, 20, 1), face(20, 0, 1, 10, 2)],
        faceSubset: { faceIds: [{ elementId: 10, faceIndex: 0 }] },
      },
    ],
    elements: [
      {
        id: 10,
        bodyId: 1,
        primitiveRanges: [{ primitive: "triangles", primitiveStart: 0, primitiveCount: 1 }],
      },
      {
        id: 20,
        bodyId: 2,
        primitiveRanges: [{ primitive: "triangles", primitiveStart: 1, primitiveCount: 1 }],
      },
    ],
    bodies: [
      { id: 1, elementIds: [10] },
      { id: 2, elementIds: [20] },
    ],
  });
}

function face(
  elementId: number,
  faceIndex: number,
  primitiveStart: number,
  neighborElementId: number,
  bodyId: number,
) {
  return {
    elementId,
    faceIndex,
    primitiveStart,
    primitiveCount: 1,
    key: "0,1,2",
    nodeIds: [0, 1, 2],
    neighborElementId,
    bodyId,
  };
}

function syntheticLargePart() {
  const source = subsetPart.geometries[0];
  if (source?.primitive !== "triangles" || source.faces === undefined)
    throw new Error("Subset fixture missing");
  let lookups = 0;
  const faces: GeometryFaces = {
    count: 3_000_000,
    at: (ordinal) => {
      lookups += 1;
      return face(1, ordinal, ordinal, 0, 0);
    },
    get: () => undefined,
    *entries() {},
    *[Symbol.iterator]() {},
  };
  const geometry = { ...source, indices: new Uint32Array([0, 1, 2]), faces };
  const part = { ...subsetPart, id: 9, geometries: [geometry] };
  const graph = partSemanticGraph(subsetPart);
  if (graph === undefined) throw new Error("Subset semantic graph missing");
  registerPartSemanticGraph(part, graph);
  return { part, geometry, lookupCount: () => lookups };
}

function writtenWords(gpu: ReturnType<typeof fakeGpuDevice>, buffer: GPUBuffer): Uint32Array {
  const write = gpu.writes.find((candidate) => candidate.buffer === buffer);
  if (write === undefined) throw new Error("GPU buffer write missing");
  return new Uint32Array(write.bytes.buffer, write.bytes.byteOffset, write.bytes.byteLength / 4);
}
