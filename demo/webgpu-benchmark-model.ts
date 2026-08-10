import { computeBounds, type Geometry, type Part } from "../src/geometry/part";
import { translation } from "../src/math/mat4";
import { createScene, type Scene } from "../src/scene/scene";
import { createPerformancePreset } from "./performance-fixture";

const PART_ID = 1;
const ROOT_ASSEMBLY_ID = 1;

export interface WebGpuBenchmarkCase {
  readonly id: string;
  readonly kind: "instancing-heavy" | "unique-geometry";
  readonly scene: Scene;
  readonly gridCells: number;
  readonly instanceCount: number;
}

export interface BenchmarkMemoryEstimate {
  readonly geometryBytes: number;
  readonly pickMetadataBytes: number;
  readonly edgeIndexBytes: number;
  readonly instanceBytes: number;
  readonly fixedBufferBytes: number;
  readonly totalBufferBytes: number;
  readonly visibleDepthBytes: number;
  readonly pickIdTargetBytes: number;
  readonly pickDepthBytes: number;
  readonly totalRenderTargetBytes: number;
}

/** Returns the fixed benchmark matrix, optionally including the larger local case. */
export function benchmarkCaseSpecs(includeLarge: boolean): readonly {
  readonly id: string;
  readonly kind: WebGpuBenchmarkCase["kind"];
  readonly gridCells: number;
  readonly instanceCount: number;
}[] {
  return [
    { id: "instanced-2.10m", kind: "instancing-heavy", gridCells: 128, instanceCount: 64 },
    { id: "unique-250k", kind: "unique-geometry", gridCells: 354, instanceCount: 1 },
    { id: "unique-1m", kind: "unique-geometry", gridCells: 707, instanceCount: 1 },
    ...(includeLarge
      ? [
          {
            id: "unique-2m-local",
            kind: "unique-geometry" as const,
            gridCells: 1_000,
            instanceCount: 1,
          },
        ]
      : []),
  ];
}

/** Builds one deterministic benchmark scene without including generation in its timings. */
export function createBenchmarkCase(spec: {
  readonly id: string;
  readonly kind: WebGpuBenchmarkCase["kind"];
  readonly gridCells: number;
  readonly instanceCount: number;
}): WebGpuBenchmarkCase {
  if (spec.kind === "instancing-heavy") {
    return { ...spec, scene: createPerformancePreset().scene };
  }
  const geometry = createGridGeometry(spec.gridCells);
  const part: Part = { id: PART_ID, geometry, bounds: computeBounds(geometry) };
  const scene = createScene()
    .addPart(part)
    .addAssembly({
      id: ROOT_ASSEMBLY_ID,
      name: spec.id,
      placements: [{ kind: "part", partId: PART_ID, transform: translation(0, 0, 0) }],
    })
    .withRoot(ROOT_ASSEMBLY_ID)
    .build();
  return { ...spec, scene };
}

/** Estimates renderer-owned buffers and render targets from their documented layouts. */
export function estimateBenchmarkMemory(
  gridCells: number,
  instanceCount: number,
  width: number,
  height: number,
): BenchmarkMemoryEstimate {
  const vertices = (gridCells + 1) ** 2;
  const triangles = gridCells * gridCells * 2;
  const edges = gridCells * gridCells * 3 + gridCells * 2;
  const geometryBytes = vertices * 3 * 4 * 2 + triangles * 3 * 4;
  const pickMetadataBytes = triangles * 4 * 2 + vertices * 4;
  const edgeIndexBytes = edges * 2 * 4;
  const instanceBytes = instanceCount * (96 + 4 + 4);
  const fixedBufferBytes = 80 + 16 + 4 + (16 + 128 * 48);
  const totalBufferBytes =
    geometryBytes + pickMetadataBytes + edgeIndexBytes + instanceBytes + fixedBufferBytes;
  const pixels = width * height;
  const visibleDepthBytes = pixels * 4;
  const pickIdTargetBytes = pixels * 4 * 4;
  const pickDepthBytes = pixels * 4;
  return {
    geometryBytes,
    pickMetadataBytes,
    edgeIndexBytes,
    instanceBytes,
    fixedBufferBytes,
    totalBufferBytes,
    visibleDepthBytes,
    pickIdTargetBytes,
    pickDepthBytes,
    totalRenderTargetBytes: visibleDepthBytes + pickIdTargetBytes + pickDepthBytes,
  };
}

function createGridGeometry(cells: number): Geometry {
  const positions = new Float32Array((cells + 1) * (cells + 1) * 3);
  const indices = new Uint32Array(cells * cells * 6);
  for (let y = 0; y <= cells; y++) {
    for (let x = 0; x <= cells; x++) {
      const offset = (y * (cells + 1) + x) * 3;
      positions[offset] = x / cells;
      positions[offset + 1] = y / cells;
      positions[offset + 2] = 0;
    }
  }
  for (let y = 0; y < cells; y++) {
    for (let x = 0; x < cells; x++) {
      const cell = y * cells + x;
      const bottomLeft = y * (cells + 1) + x;
      const bottomRight = bottomLeft + 1;
      const topLeft = bottomLeft + cells + 1;
      const topRight = topLeft + 1;
      indices.set([bottomLeft, bottomRight, topRight, bottomLeft, topRight, topLeft], cell * 6);
    }
  }
  const nodePickIds = new Uint32Array(positions.length / 3);
  for (let node = 0; node < nodePickIds.length; node++) nodePickIds[node] = node + 1;
  return {
    positions,
    indices,
    elements: [{ id: 0, triangleStart: 0, triangleCount: indices.length / 3 }],
    nodePickIds,
    nodePositions: positions,
  };
}
