import { describe, expect, it } from "vitest";
import { measureMs } from "../measure";
import { createPartFromExplicitTopology, type ExplicitTopologyInput } from "@/entries/model";
import { validateExplicitTopologyInput } from "@/geometry/explicit-topology/input";
import { partSemanticGraph } from "@/geometry/semantic/part-semantic-graph";
import type { Part } from "@/geometry/part";
import { expandPointGeometry } from "@/renderer/resources/point-sprites";
import { triangleUploadData } from "@/renderer/resources/triangle-upload";
import { expandSurfaceGeometry } from "@/renderer/resources/surface-geometry";

const FACET_COUNT = 20_000;

interface TopologyMemory {
  readonly inputBytes: number;
  readonly builderBytes: number;
  readonly retainedBytes: number;
  readonly uploadBytes: number;
  readonly part: Part;
}

function denseSurfaceInput(faceOwned: boolean): ExplicitTopologyInput {
  const connectivity = new Uint32Array(FACET_COUNT * 4);
  const elementIds = new Uint32Array(FACET_COUNT);
  const faceIndices = new Uint32Array(FACET_COUNT);
  for (let facet = 0; facet < FACET_COUNT; facet += 1) {
    const offset = facet * 4;
    connectivity[offset] = 3;
    connectivity[offset + 1] = 0;
    connectivity[offset + 2] = 1;
    connectivity[offset + 3] = 2;
    elementIds[facet] = facet + 1;
  }
  const common = {
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0, 100, 100, 100]),
    lines: {
      connectivity: new Uint32Array([2, 2, 3]),
      elementIds: new Uint32Array([FACET_COUNT + 1]),
    },
    points: { nodeIds: new Uint32Array([3]), elementIds: new Uint32Array([FACET_COUNT + 2]) },
  };
  return faceOwned
    ? { ...common, facets: { connectivity, elementIds, faceIndices } }
    : { ...common, facets: { connectivity, elementIds } };
}

function memoryFor(input: ExplicitTopologyInput): TopologyMemory {
  const validated = validateExplicitTopologyInput(input);
  const part = createPartFromExplicitTopology(8, input);
  return {
    inputBytes: typedBytes(input),
    builderBytes: typedBytes(validated),
    retainedBytes: retainedPartBytes(part),
    uploadBytes: uploadBytes(part),
    part,
  };
}

function typedBytes(value: unknown): number {
  const arrays = new Set<ArrayBufferView>();
  collectTypedArrays(value, arrays);
  let bytes = 0;
  for (const array of arrays) bytes += array.byteLength;
  return bytes;
}

function collectTypedArrays(value: unknown, arrays: Set<ArrayBufferView>): void {
  if (ArrayBuffer.isView(value)) {
    arrays.add(value);
    return;
  }
  if (value === null || typeof value !== "object") return;
  for (const child of Object.values(value)) collectTypedArrays(child, arrays);
}

function retainedPartBytes(part: Part): number {
  const graph = partSemanticGraph(part);
  return typedBytes({
    nodePositions: part.nodePositions,
    geometries: part.geometries.map(({ positions, indices, nodePickIds }) => ({
      positions,
      indices,
      nodePickIds,
    })),
    graph,
  });
}

function uploadBytes(part: Part): number {
  return typedBytes(
    part.geometries.map((geometry) =>
      geometry.primitive === "triangles"
        ? triangleUploadData(geometry)
        : geometry.primitive === "lines"
          ? expandSurfaceGeometry(geometry)
          : expandPointGeometry(geometry),
    ),
  );
}

function reportMemory(label: string, memory: TopologyMemory): void {
  if (process.env["PERF_REPORT"] === undefined) return;
  console.log(
    `${label}: input=${memory.inputBytes} B, builder=${memory.builderBytes} B, ` +
      `retained=${memory.retainedBytes} B, upload=${memory.uploadBytes} B`,
  );
}

function reportConstruction(label: string, milliseconds: number): void {
  if (process.env["PERF_REPORT"] === undefined) return;
  console.log(`${label}: construction=${milliseconds.toFixed(3)} ms`);
}

describe("explicit-topology memory budget", () => {
  it("keeps faceless mixed surfaces dense without retained face columns", () => {
    const facelessInput = denseSurfaceInput(false);
    const faceOwnedInput = denseSurfaceInput(true);
    const faceless = memoryFor(facelessInput);
    const faceOwned = memoryFor(faceOwnedInput);
    const graph = partSemanticGraph(faceless.part);
    const validated = validateExplicitTopologyInput(denseSurfaceInput(false));
    const facelessConstruction = measureMs(
      () => {
        createPartFromExplicitTopology(8, facelessInput);
      },
      { samples: 3 },
    );
    const faceOwnedConstruction = measureMs(
      () => {
        createPartFromExplicitTopology(8, faceOwnedInput);
      },
      { samples: 3 },
    );
    reportMemory("faceless explicit topology", faceless);
    reportMemory("face-owned explicit topology", faceOwned);
    reportConstruction("faceless explicit topology", facelessConstruction);
    reportConstruction("face-owned explicit topology", faceOwnedConstruction);

    expect(Object.values(validated.facets).some(Array.isArray)).toBe(false);
    expect(Array.isArray(faceless.part.elements)).toBe(false);
    expect(graph?.faceIndices).toHaveLength(0);
    expect(graph?.faceNodeIds).toHaveLength(0);
    expect(graph?.faceNeighborElementOrdinals).toHaveLength(0);
    expect(graph?.faceGeometryOffsets).toHaveLength(faceless.part.geometries.length + 1);
    expect(faceless.retainedBytes).toBeLessThan(faceOwned.retainedBytes);
    expect(faceless.builderBytes).toBeLessThan(faceOwned.builderBytes);
    expect(faceless.uploadBytes).toBe(faceOwned.uploadBytes);
    expect(facelessConstruction).toBeLessThanOrEqual(600);
    expect(faceOwnedConstruction).toBeLessThanOrEqual(1_600);
  });
});
