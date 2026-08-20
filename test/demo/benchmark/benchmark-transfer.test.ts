import { describe, expect, it } from "vitest";
import { benchmarkCaseSpecs, createBenchmarkCase } from "../../../demo/benchmark/model";
import {
  buildDenseTet4Payload,
  type DenseTet4Payload,
} from "../../../demo/benchmark/tet4-transfer";
import { reconstructBenchmarkScene, transferredByteLength } from "../../../demo/benchmark/transfer";
import { getPartSemanticIndex } from "@/geometry/part-semantic-index";
import { partSemanticGraph } from "@/geometry/semantic/part-semantic-graph";
import { buildFaceSubsetIndices } from "@/renderer/selection/face-subset";
import {
  buildElementPrimitiveOrdinals,
  buildPrimitiveFaceBodyPickData,
} from "@/renderer/picking/ids";

describe("dense Tet4 benchmark transfer", () => {
  it("reconstructs the canonical topology, skin, and authored edge metadata", () => {
    const source = benchmarkCaseSpecs(false).find(
      (candidate) => candidate.id === "fe-tet4-solid-132k",
    );
    if (source === undefined) throw new Error("Tet4 benchmark spec is missing");
    const spec = { ...source, gridCells: 2 };
    const canonicalPart = createBenchmarkCase(spec).scene.parts.get(1);
    if (canonicalPart === undefined) throw new Error("Canonical Tet4 part is missing");

    const transfer = buildDenseTet4Payload(spec.gridCells).payload;
    const reconstructed = reconstructBenchmarkScene(transfer);
    const reconstructedPart = reconstructed.scene.parts.get(1);
    if (reconstructedPart === undefined) throw new Error("Reconstructed Tet4 part is missing");
    const canonicalGeometry = canonicalPart.geometries[0];
    const reconstructedGeometry = reconstructedPart.geometries[0];
    if (canonicalGeometry === undefined || reconstructedGeometry === undefined) {
      throw new Error("Tet4 triangle geometry is missing");
    }

    expect(reconstructedPart.elements?.count).toBe(canonicalPart.elements?.count);
    expect([...(reconstructedPart.bodies ?? [])]).toEqual([...(canonicalPart.bodies ?? [])]);
    expect(reconstructedPart.nodePositions).toEqual(canonicalPart.nodePositions);
    expect(reconstructedGeometry.primitive).toBe("triangles");
    expect(canonicalGeometry.primitive).toBe("triangles");
    if (
      reconstructedGeometry.primitive !== "triangles" ||
      canonicalGeometry.primitive !== "triangles"
    ) {
      throw new Error("Tet4 triangle geometry is missing");
    }
    expect(authoredNodeIndices(reconstructedGeometry)).toEqual(
      authoredNodeIndices(canonicalGeometry),
    );
    expect([...(reconstructedGeometry.faces ?? [])]).toEqual([...(canonicalGeometry.faces ?? [])]);
    expect([...(reconstructedGeometry.edges ?? [])]).toEqual([...(canonicalGeometry.edges ?? [])]);
    expect(sortedFaceRefs(reconstructedGeometry.faceSubset)).toEqual(
      sortedFaceRefs(canonicalGeometry.faceSubset),
    );
    expect(reconstructedPart.bounds).toEqual(canonicalPart.bounds);
    expect(reconstructed.semanticAllocationCounts).toEqual({
      elementDescriptors: 0,
      primitiveRangeArrays: 0,
      primitiveRangeDescriptors: 0,
      faceDescriptors: 0,
      faceNodeArrays: 0,
      faceNodeReferences: 576,
      faceKeyReferences: 0,
      faceSubsetReferences: 48,
      edgeDescriptors: 0,
      edgeNodeArrays: 0,
      edgeNodeReferences: 196,
      edgeIncidentElementReferences: 288,
      edgeFaceReferenceArrays: 0,
      edgeFaceReferences: 576,
      bodyDescriptors: 0,
      bodyElementReferences: 0,
      semanticIndex: {
        elementEntries: 0,
        elementOrdinalEntries: 0,
        bodyEntries: 0,
        bodyByElementEntries: 0,
        faceEntries: 0,
        edgeEntries: 0,
        nodeTriangleFaceOffsetsBytes: 2_308,
        nodeTriangleFaceIdsBytes: 2_304,
        neighborTriangleFaceOffsetsBytes: 196,
        neighborTriangleFaceIdsBytes: 576,
      },
    });
  });

  it("builds graph indexes without descriptor materialization", () => {
    const payload = buildDenseTet4Payload(2).payload;
    const part = reconstructBenchmarkScene(payload).scene.parts.get(1);
    if (part === undefined) throw new Error("Tet4 part is missing");
    const graph = partSemanticGraph(part);
    if (graph === undefined) throw new Error("Tet4 graph is missing");
    const index = getPartSemanticIndex(part);
    expect(index.elementCount).toBe(payload.elementCount);
    expect(index.face(1, 0)).toBeDefined();
    expect(part.elements?.count).toBe(payload.elementCount);
    expect(graph.elementIds).toHaveLength(payload.elementCount);
  });

  it("keeps graph upload metadata on typed tables", () => {
    const payload = buildDenseTet4Payload(2).payload;
    const part = reconstructBenchmarkScene(payload).scene.parts.get(1);
    if (part === undefined) throw new Error("Tet4 part is missing");
    const geometry = part.geometries[0];
    if (geometry?.primitive !== "triangles") throw new Error("Tet4 triangles are missing");
    const index = getPartSemanticIndex(part);
    const ordinals = buildElementPrimitiveOrdinals(geometry, [...(part.elements ?? [])], (id) =>
      index.elementOrdinal(id),
    );
    const topology = buildPrimitiveFaceBodyPickData(geometry, [...(part.elements ?? [])]);
    const subset = buildFaceSubsetIndices(geometry);
    expect(ordinals.length).toBe(payload.elementCount * 4);
    expect(topology.length).toBe(payload.elementCount * 4 * 5);
    expect(subset.length).toBe(payload.boundaryFaceIndices.length * 3);
    expect(partSemanticGraph(part)?.faceOwnerElementOrdinals).toHaveLength(
      payload.elementCount * 4,
    );
  });

  it("uses node ids directly as vertices and bounds dense preset sizes", () => {
    const result = buildDenseTet4Payload(2);
    expect(result.payload.positions).toBe(result.payload.nodePositions);
    expect(Array.from(result.payload.nodePickIds)).toEqual(
      Array.from({ length: 27 }, (_, index) => index + 1),
    );
    expect(() => buildDenseTet4Payload(0)).toThrow(/\[1,200\]/);
    expect(() => buildDenseTet4Payload(1.5)).toThrow(/integer/);
    expect(() => buildDenseTet4Payload(201)).toThrow(/\[1,200\]/);
  });

  it("uses the structured six-Tet4 neighbor table and boundary order", () => {
    const gridSize = 2;
    const payload = buildDenseTet4Payload(gridSize).payload;
    const element = (x: number, y: number, z: number, local: number): number =>
      (z * gridSize * gridSize + y * gridSize + x) * 6 + local;
    const directNeighborCases = [
      [element(0, 0, 0, 0), 0, element(0, 0, 0, 5)],
      [element(0, 0, 0, 0), 2, element(0, 0, 0, 1)],
      [element(0, 0, 0, 1), 0, element(0, 0, 0, 0)],
      [element(0, 0, 0, 1), 2, element(0, 0, 0, 2)],
      [element(0, 0, 0, 2), 0, element(0, 0, 0, 1)],
      [element(0, 0, 0, 2), 2, element(0, 0, 0, 3)],
      [element(0, 0, 0, 3), 0, element(0, 0, 0, 2)],
      [element(0, 0, 0, 3), 2, element(0, 0, 0, 4)],
      [element(0, 0, 0, 4), 0, element(0, 0, 0, 3)],
      [element(0, 0, 0, 4), 2, element(0, 0, 0, 5)],
      [element(0, 0, 0, 5), 0, element(0, 0, 0, 4)],
      [element(0, 0, 0, 5), 2, element(0, 0, 0, 0)],
      [element(0, 0, 0, 0), 1, element(1, 0, 0, 2)],
      [element(1, 0, 0, 2), 3, element(0, 0, 0, 0)],
      [element(0, 0, 0, 5), 1, element(1, 0, 0, 3)],
      [element(1, 0, 0, 3), 3, element(0, 0, 0, 5)],
      [element(0, 0, 0, 1), 1, element(0, 1, 0, 5)],
      [element(0, 1, 0, 5), 3, element(0, 0, 0, 1)],
      [element(0, 0, 0, 2), 1, element(0, 1, 0, 4)],
      [element(0, 1, 0, 4), 3, element(0, 0, 0, 2)],
      [element(0, 0, 0, 3), 1, element(0, 0, 1, 1)],
      [element(0, 0, 1, 1), 3, element(0, 0, 0, 3)],
      [element(0, 0, 0, 4), 1, element(0, 0, 1, 0)],
      [element(0, 0, 1, 0), 3, element(0, 0, 0, 4)],
    ] as const;
    for (const [elementIndex, faceIndex, neighborIndex] of directNeighborCases) {
      expect(faceNeighborId(payload, elementIndex, faceIndex)).toBe(neighborIndex + 1);
    }

    const exteriorCases = [
      [element(1, 0, 0, 0), 1],
      [element(1, 0, 0, 5), 1],
      [element(0, 0, 0, 2), 3],
      [element(0, 0, 0, 3), 3],
      [element(0, 1, 0, 1), 1],
      [element(0, 1, 0, 2), 1],
      [element(0, 0, 0, 4), 3],
      [element(0, 0, 0, 5), 3],
      [element(0, 0, 1, 3), 1],
      [element(0, 0, 1, 4), 1],
      [element(0, 0, 0, 0), 3],
      [element(0, 0, 0, 1), 3],
    ] as const;
    for (const [elementIndex, faceIndex] of exteriorCases) {
      const faceNumber = elementIndex * 4 + faceIndex;
      expect(faceNeighborId(payload, elementIndex, faceIndex)).toBe(0);
      expect(payload.boundaryFaceIndices).toContain(faceNumber);
    }

    const singleCell = buildDenseTet4Payload(1).payload;
    expect(singleCell.boundaryFaceIndices).toEqual(
      Uint32Array.from([1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23]),
    );
  });

  it.skipIf(process.env["FEMGX_RUN_HEAVY_TRANSFER"] !== "1")(
    "builds the reported grid beyond safe numeric face packing",
    () => {
      const gridSize = 60;
      const result = buildDenseTet4Payload(gridSize);
      console.log(
        `dense Tet4 grid ${gridSize}: topology ${result.timings.topologyMs.toFixed(0)} ms, ` +
          `total ${(result.timings.generationMs + result.timings.topologyMs + result.timings.tessellationMs).toFixed(0)} ms`,
      );
      expect(result.payload.elementCount).toBe(6 * gridSize ** 3);
      expect(result.payload.boundaryFaceIndices).toHaveLength(12 * gridSize ** 2);
      expect(result.payload.faceNeighborIds[4_060_854]).toBe(1_015_215);
      expect(result.payload.faceNeighborIds[4_060_856]).toBe(1_015_214);
    },
  );

  it.skipIf(process.env["FEMGX_RUN_HEAVY_TRANSFER"] !== "1")(
    "builds the full worker payload within the bounded dense path",
    () => {
      const gridSize = Number(process.env["FEMGX_HEAVY_GRID"] ?? 28);
      const start = performance.now();
      const result = buildDenseTet4Payload(gridSize);
      const elapsed = performance.now() - start;
      const reconstructionStart = performance.now();
      const reconstructed = reconstructBenchmarkScene(result.payload);
      const reconstructionMs = performance.now() - reconstructionStart;
      console.log(
        `dense Tet4 transfer: ${elapsed.toFixed(0)} ms build + ${reconstructionMs.toFixed(0)} ms reconstruction, ` +
          `${result.timings.topologyMs.toFixed(0)} ms topology, ` +
          `${reconstructed.finalRetainedTypedBytes} retained typed bytes, ${transferredByteLength(
            result.payload,
          )} transferred bytes`,
      );
      expect(result.payload.elementCount).toBe(gridSize ** 3 * 6);
      expect(result.payload.boundaryFaceIndices).toHaveLength(12 * gridSize ** 2);
    },
  );
});

function authoredNodeIndices(geometry: {
  readonly indices: Uint32Array;
  readonly nodePickIds?: Uint32Array;
}): readonly number[] {
  return Array.from(geometry.indices, (vertex) => (geometry.nodePickIds?.[vertex] ?? 0) - 1);
}

function sortedFaceRefs(
  subset: Iterable<{ readonly elementId: number; readonly faceIndex: number }> | undefined,
): readonly string[] {
  return Array.from(subset ?? [], (face) => `${face.elementId}/${face.faceIndex}`).sort();
}

function faceNeighborId(
  payload: DenseTet4Payload,
  elementIndex: number,
  faceIndex: number,
): number {
  return payload.faceNeighborIds[elementIndex * 4 + faceIndex] ?? 0;
}
