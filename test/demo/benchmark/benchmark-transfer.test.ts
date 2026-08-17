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
    const reconstructedPart = reconstructBenchmarkScene(transfer).scene.parts.get(1);
    if (reconstructedPart === undefined) throw new Error("Reconstructed Tet4 part is missing");
    const canonicalGeometry = canonicalPart.geometries[0];
    const reconstructedGeometry = reconstructedPart.geometries[0];
    if (canonicalGeometry === undefined || reconstructedGeometry === undefined) {
      throw new Error("Tet4 triangle geometry is missing");
    }

    expect(reconstructedPart.elements).toEqual(canonicalPart.elements);
    expect(reconstructedPart.bodies).toEqual(canonicalPart.bodies);
    expect(reconstructedPart.nodePositions).toEqual(canonicalPart.nodePositions);
    expect(reconstructedGeometry).toEqual(canonicalGeometry);
    expect(reconstructedPart.bounds).toEqual(canonicalPart.bounds);
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
