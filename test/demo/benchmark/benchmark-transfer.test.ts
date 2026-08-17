import { describe, expect, it } from "vitest";
import { benchmarkCaseSpecs, createBenchmarkCase } from "../../../demo/benchmark/model";
import { buildDenseTet4Payload } from "../../../demo/benchmark/tet4-transfer";
import { reconstructBenchmarkScene, transferredByteLength } from "../../../demo/benchmark/transfer";

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

    expect(reconstructedPart.elements).toEqual(canonicalPart.elements);
    expect(reconstructedPart.bodies).toEqual(canonicalPart.bodies);
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
    expect(reconstructedGeometry.faces).toEqual(canonicalGeometry.faces);
    expect(reconstructedGeometry.edges).toEqual(canonicalGeometry.edges);
    expect(reconstructedGeometry.faceSubset).toEqual(canonicalGeometry.faceSubset);
    expect(reconstructedPart.bounds).toEqual(canonicalPart.bounds);
    expect(reconstructed.semanticAllocationCounts).toEqual({
      elementDescriptors: 48,
      primitiveRangeArrays: 48,
      primitiveRangeDescriptors: 48,
      faceDescriptors: 192,
      faceNodeArrays: 192,
      faceNodeReferences: 576,
      faceKeyReferences: 192,
      faceSubsetReferences: 48,
      edgeDescriptors: 98,
      edgeNodeArrays: 98,
      edgeNodeReferences: 196,
      edgeIncidentElementReferences: 288,
      edgeFaceReferenceArrays: 98,
      edgeFaceReferences: 576,
      bodyDescriptors: 1,
      bodyElementReferences: 48,
      semanticIndex: {
        elementEntries: 48,
        elementOrdinalEntries: 48,
        bodyEntries: 1,
        bodyByElementEntries: 48,
        faceEntries: 192,
        edgeEntries: 98,
        nodeTriangleFaceOffsetsBytes: 112,
        nodeTriangleFaceIdsBytes: 2_304,
        neighborTriangleFaceOffsetsBytes: 196,
        neighborTriangleFaceIdsBytes: 576,
      },
    });
  });

  it("uses node ids directly as vertices and bounds dense preset sizes", () => {
    const result = buildDenseTet4Payload(2);
    expect(result.payload.positions).toBe(result.payload.nodePositions);
    expect(Array.from(result.payload.nodePickIds)).toEqual(
      Array.from({ length: 27 }, (_, index) => index + 1),
    );
    expect(() => buildDenseTet4Payload(36)).toThrow(/\[1,35\]/);
  });

  it.skipIf(process.env["FEMGX_RUN_HEAVY_TRANSFER"] !== "1")(
    "builds the full worker payload within the bounded dense path",
    () => {
      const start = performance.now();
      const result = buildDenseTet4Payload(28);
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
      expect(result.payload.elementCount).toBe(131_712);
      expect(result.payload.boundaryFaceIndices).toHaveLength(9_408);
    },
  );
});

function authoredNodeIndices(geometry: {
  readonly indices: Uint32Array;
  readonly nodePickIds?: Uint32Array;
}): readonly number[] {
  return Array.from(geometry.indices, (vertex) => (geometry.nodePickIds?.[vertex] ?? 0) - 1);
}
