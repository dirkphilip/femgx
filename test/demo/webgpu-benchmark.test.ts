import { describe, expect, it } from "vitest";
import { submittedTriangleCount } from "../../demo/benchmark/measurement";
import {
  benchmarkCaseSpecs,
  createBenchmarkCase,
  estimateBenchmarkMemory,
  workbenchBenchmarkSpecs,
} from "../../demo/benchmark/model";
import { summarizeInteractiveSample } from "../../demo/benchmark/interactive";
import {
  createStructuredFeModel,
  createStructuredFePart,
} from "../../demo/benchmark/structured-fe";
import { createLazyBenchmarkModel } from "../../demo/workbench/models/model";
import { createCamera } from "../../src/entries/camera";
import { buildFaceSubsetIndices } from "../../src/renderer/selection/face-subset";
import { createPackedSceneRuntime } from "../../src/scene-runtime/runtime";

describe("WebGPU benchmark models", () => {
  it("keeps instanced and bounded unique-geometry cases distinct", () => {
    expect(
      benchmarkCaseSpecs(false).map(({ id, kind, elementFamily }) => ({ id, kind, elementFamily })),
    ).toEqual([
      { id: "instanced-2.10m", kind: "instancing-heavy", elementFamily: "quad" },
      { id: "unique-250k", kind: "unique-geometry", elementFamily: "triangle" },
      { id: "unique-1m", kind: "unique-geometry", elementFamily: "triangle" },
      { id: "many-parts-100", kind: "many-parts", elementFamily: "triangle" },
      { id: "many-parts-1000", kind: "many-parts", elementFamily: "triangle" },
      { id: "placements-10k", kind: "placement-heavy", elementFamily: "quad" },
      { id: "bodies-256", kind: "body-heavy", elementFamily: "quad" },
      { id: "fe-quad-shell-visual", kind: "structured-fe", elementFamily: "quad" },
      { id: "fe-quad8-shell-visual", kind: "structured-fe", elementFamily: "quad8" },
      { id: "fe-hex8-solid-visual", kind: "structured-fe", elementFamily: "hex8" },
      {
        id: "fe-hex8-orientation-visual",
        kind: "structured-fe",
        elementFamily: "hex8",
      },
      { id: "fe-hex20-solid-visual", kind: "structured-fe", elementFamily: "hex20" },
    ]);
    expect(benchmarkCaseSpecs(true).at(-1)?.id).toBe("unique-2m-local");
  });

  it("builds one reusable grid part at the requested bounded size", () => {
    const benchmarkCase = createBenchmarkCase({
      id: "tiny-test",
      name: "Tiny test",
      kind: "unique-geometry",
      gridCells: 2,
      partCount: 1,
      instanceCount: 1,
      bodyCount: 0,
      elementFamily: "quad",
    });
    const part = benchmarkCase.scene.parts.get(1);
    expect(part?.geometries[0]?.positions).toHaveLength(27);
    expect(part?.geometries[0]?.indices).toHaveLength(24);
    expect(part?.elements).toEqual([
      {
        id: 1,
        primitiveRanges: [{ primitive: "triangles", primitiveStart: 0, primitiveCount: 2 }],
      },
      {
        id: 2,
        primitiveRanges: [{ primitive: "triangles", primitiveStart: 2, primitiveCount: 2 }],
      },
      {
        id: 3,
        primitiveRanges: [{ primitive: "triangles", primitiveStart: 4, primitiveCount: 2 }],
      },
      {
        id: 4,
        primitiveRanges: [{ primitive: "triangles", primitiveStart: 6, primitiveCount: 2 }],
      },
    ]);
  });

  it("keeps many-part and body-heavy cases structurally distinct", () => {
    const manyParts = createBenchmarkCase({
      id: "many-parts-test",
      name: "Many parts test",
      kind: "many-parts",
      gridCells: 2,
      partCount: 3,
      instanceCount: 3,
      bodyCount: 0,
      elementFamily: "triangle",
    });
    const bodyHeavy = createBenchmarkCase({
      id: "bodies-test",
      name: "Bodies test",
      kind: "body-heavy",
      gridCells: 4,
      partCount: 1,
      instanceCount: 1,
      bodyCount: 4,
      elementFamily: "quad",
    });
    expect(manyParts.scene.parts.size).toBe(3);
    expect(manyParts.scene.parts.get(1)).not.toBe(manyParts.scene.parts.get(2));
    expect(bodyHeavy.scene.parts.get(1)?.bodies).toHaveLength(4);
    expect(bodyHeavy.scene.parts.get(1)?.elements).toHaveLength(16);
    expect(
      bodyHeavy.scene.parts.get(1)?.elements?.every((element) => element.bodyId !== undefined),
    ).toBe(true);
  });

  it("builds shared-node shell and solid FE families with truthful metadata", () => {
    const quad = createStructuredFeModel("quad", 2);
    const quad8 = createStructuredFeModel("quad8", 2);
    const hex8 = createStructuredFeModel("hex8", 2);
    const hex20 = createStructuredFeModel("hex20", 2);
    expect(quad.nodes).toHaveLength(27);
    expect(quad.elements).toHaveLength(4);
    expect(quad8.nodes).toHaveLength(63);
    expect(quad8.elements).toHaveLength(4);
    expect(
      new Set(quad8.elements[0]?.nodeIds.filter((id) => quad8.elements[1]?.nodeIds.includes(id))),
    ).toHaveLength(3);
    expect(hex8.nodes).toHaveLength(81);
    expect(hex8.elements).toHaveLength(8);
    expect(hex20.nodes).toHaveLength(243);
    expect(hex20.elements).toHaveLength(8);
    expect(
      new Set(hex20.elements[0]?.nodeIds.filter((id) => hex20.elements[1]?.nodeIds.includes(id))),
    ).toHaveLength(8);

    const quadPart = createStructuredFePart(1, "quad", 2);
    const quad8Part = createStructuredFePart(2, "quad8", 2);
    const hex8Part = createStructuredFePart(3, "hex8", 2);
    const hex20Part = createStructuredFePart(4, "hex20", 2);
    const quadGeometry = quadPart.geometries[0];
    const quad8Geometry = quad8Part.geometries[0];
    const hex8Geometry = hex8Part.geometries[0];
    const hex20Geometry = hex20Part.geometries[0];
    if (
      quadGeometry?.primitive !== "triangles" ||
      quad8Geometry?.primitive !== "triangles" ||
      hex8Geometry?.primitive !== "triangles" ||
      hex20Geometry?.primitive !== "triangles"
    )
      throw new Error("Structured fixtures must contain triangle geometry");
    expect(quadPart.elements).toHaveLength(4);
    expect(quadGeometry.faces).toHaveLength(4);
    expect(quadGeometry.indices).toHaveLength(4 * 2 * 3);
    expect(quad8Geometry.faces).toHaveLength(4);
    expect(quad8Geometry.indices).toHaveLength(4 * 6 * 3);
    expect(hex8Geometry.faces).toHaveLength(48);
    expect(hex8Geometry.indices).toHaveLength(48 * 2 * 3);
    expect(hex20Geometry.faces).toHaveLength(48);
    expect(hex20Geometry.indices).toHaveLength(48 * 6 * 3);
    expect(hex20Part.bodies).toEqual([
      { id: 1, name: "hex20 structured body", elementIds: [1, 2, 3, 4, 5, 6, 7, 8] },
    ]);
  });

  it("keeps structured solid geometry complete while submitting only exterior triangles", () => {
    const hex8Part = createStructuredFePart(1, "hex8", 8);
    const hex20Part = createStructuredFePart(2, "hex20", 6);
    const hex8Geometry = hex8Part.geometries[0];
    const hex20Geometry = hex20Part.geometries[0];
    if (hex8Geometry?.primitive !== "triangles" || hex20Geometry?.primitive !== "triangles") {
      throw new Error("Structured fixtures must contain triangle geometry");
    }
    expect(hex8Geometry.faces).toHaveLength(6 * 8 ** 3);
    expect(hex8Geometry.indices).toHaveLength(6 * 8 ** 3 * 2 * 3);
    expect(hex8Geometry.faceSubset?.faceIds).toHaveLength(6 * 8 ** 2);
    expect(buildFaceSubsetIndices(hex8Geometry)).toHaveLength(768 * 3);
    expect(hex20Geometry.faces).toHaveLength(6 * 6 ** 3);
    expect(hex20Geometry.indices).toHaveLength(6 * 6 ** 3 * 6 * 3);
    expect(hex20Geometry.faceSubset?.faceIds).toHaveLength(6 * 6 ** 2);
    expect(buildFaceSubsetIndices(hex20Geometry)).toHaveLength(1_296 * 3);

    const hex8Spec = benchmarkCaseSpecs(false).find(
      (candidate) => candidate.id === "fe-hex8-solid-visual",
    );
    const hex20Spec = benchmarkCaseSpecs(false).find(
      (candidate) => candidate.id === "fe-hex20-solid-visual",
    );
    if (hex8Spec === undefined || hex20Spec === undefined) {
      throw new Error("Structured solid benchmark specs are missing");
    }
    const hex8Case = createBenchmarkCase(hex8Spec);
    const hex20Case = createBenchmarkCase(hex20Spec);
    const hex8Runtime = createPackedSceneRuntime(hex8Case.scene);
    const hex20Runtime = createPackedSceneRuntime(hex20Case.scene);
    expect(submittedTriangleCount(hex8Case, hex8Runtime, false)).toBe(768);
    expect(submittedTriangleCount(hex20Case, hex20Runtime, false)).toBe(1_296);
    expect(submittedTriangleCount(hex8Case, hex8Runtime, true)).toBe(768);
    expect(submittedTriangleCount(hex20Case, hex20Runtime, true)).toBe(1_296);
  });

  it("keeps the opt-in orientation workload aligned to structured element ids", () => {
    const spec = benchmarkCaseSpecs(false).find(
      (candidate) => candidate.id === "fe-hex8-orientation-visual",
    );
    if (spec === undefined) throw new Error("orientation benchmark case is missing");
    const benchmarkCase = createBenchmarkCase(spec);
    expect(benchmarkCase.orientationField?.count).toBe(513);
    expect(benchmarkCase.orientationField?.values.length).toBe(513 * 3);
    expect(benchmarkCase.orientationField?.values[0]).toBe(1);
    expect(benchmarkCase.orientationField?.values[3]).toBe(-1);
    expect(benchmarkCase.orientationField?.unit).toBe("unitless");
  });

  it("reports buffer and render-target memory as an explicit sum", () => {
    const scene = createBenchmarkCase({
      id: "memory-test",
      name: "Memory test",
      kind: "unique-geometry",
      gridCells: 2,
      partCount: 1,
      instanceCount: 1,
      bodyCount: 0,
      elementFamily: "triangle",
    }).scene;
    const memory = estimateBenchmarkMemory(scene, 3, 800, 600);
    expect(memory.geometryBytes).toBe(384);
    expect(memory.resultColorBytes).toBe(176);
    expect(memory.pickMetadataBytes).toBe(400);
    expect(memory.edgeIndexBytes).toBe(0);
    expect(memory.subsetBytes).toBe(0);
    expect(memory.deformationBytes).toBe(4);
    expect(memory.pickReadbackBytes).toBe(1280);
    expect(memory.cpuSceneTypedArrayBytes).toBe(412);
    expect(memory.totalBufferBytes).toBe(
      memory.geometryBytes +
        memory.resultColorBytes +
        memory.pickMetadataBytes +
        memory.edgeIndexBytes +
        memory.subsetBytes +
        memory.deformationBytes +
        memory.instanceBytes +
        memory.highlightBytes +
        memory.fixedBufferBytes +
        memory.pickReadbackBytes,
    );
    expect(memory.retainedBufferBytes).toBe(memory.totalBufferBytes);
    expect(memory.peakRendererBytes).toBe(memory.retainedBufferBytes + memory.uploadStagingBytes);
    expect(memory.totalRenderTargetBytes).toBe(
      memory.visibleColorBytes +
        memory.visibleDepthBytes +
        memory.pickIdTargetBytes +
        memory.pickDepthBytes,
    );

    const warmMemory = estimateBenchmarkMemory(scene, 3, 800, 600, {
      materializedEdgePartIds: new Set([1]),
    });
    expect(warmMemory.geometryBytes).toBeGreaterThan(memory.geometryBytes);
    expect(warmMemory.resultColorBytes).toBeGreaterThan(memory.resultColorBytes);
    expect(warmMemory.pickMetadataBytes).toBeGreaterThan(memory.pickMetadataBytes);
    expect(warmMemory.edgeIndexBytes).toBeGreaterThan(0);
  });

  it("keeps the matrix dimensions and scaling dimensions explicit", () => {
    const specs = benchmarkCaseSpecs(false);
    expect(specs.find((spec) => spec.id === "instanced-2.10m")).toMatchObject({
      gridCells: 128,
      partCount: 1,
      instanceCount: 64,
      elementFamily: "quad",
    });
    expect(specs.find((spec) => spec.id === "many-parts-1000")).toMatchObject({
      partCount: 1_000,
      instanceCount: 1_000,
      elementFamily: "triangle",
    });
    expect(specs.find((spec) => spec.id === "placements-10k")).toMatchObject({
      partCount: 1,
      instanceCount: 10_000,
      elementFamily: "quad",
    });
    expect(specs.find((spec) => spec.id === "bodies-256")).toMatchObject({
      partCount: 1,
      bodyCount: 256,
      elementFamily: "quad",
    });
  });

  it("keeps optional benchmark cases out of the ordinary workbench selector", () => {
    expect(workbenchBenchmarkSpecs(false)).toEqual([]);
    expect(workbenchBenchmarkSpecs(false).some((spec) => spec.id === "unique-250k")).toBe(false);
    expect(workbenchBenchmarkSpecs(true).some((spec) => spec.id === "unique-250k")).toBe(true);
    expect(workbenchBenchmarkSpecs(true).some((spec) => spec.id === "unique-2m-local")).toBe(true);
  });

  it("summarizes interactive frame intervals and thresholds", () => {
    const sample = summarizeInteractiveSample([100, 116, 150, 190], 100, 200, createCamera());
    expect(sample).toMatchObject({
      durationMs: 100,
      frameCount: 4,
      fps: 40,
      p50FrameIntervalMs: 34,
      p95FrameIntervalMs: 39.4,
      maxFrameIntervalMs: 40,
      intervalsOver16_7Ms: 2,
      intervalsOver33_3Ms: 2,
    });
    expect(sample.intervalsOver16_7Percent).toBeCloseTo((2 / 3) * 100, 10);
    expect(sample.intervalsOver33_3Percent).toBeCloseTo((2 / 3) * 100, 10);
  });

  it("does not construct lazy visual cases during selector setup", async () => {
    const spec = benchmarkCaseSpecs(false).find((candidate) => candidate.id === "bodies-256");
    if (spec === undefined) throw new Error("body benchmark spec is missing");
    const lazy = createLazyBenchmarkModel(spec);
    expect(lazy.scene.parts.size).toBe(0);
    const loaded = await lazy.deferredLoad?.();
    expect(loaded?.scene.parts.size).toBe(1);
    expect(loaded?.scene.parts.get(1)?.bodies).toHaveLength(256);
  });
});
