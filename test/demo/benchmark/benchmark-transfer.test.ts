import { describe, expect, it } from "vitest";
import { benchmarkCaseSpecs, createBenchmarkCase } from "../../../demo/benchmark/model";
import { buildDenseTet4Payload } from "../../../demo/benchmark/tet4-transfer";
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
    expect(() => buildDenseTet4Payload(201)).toThrow(/\[1,200\]/);
  });

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
