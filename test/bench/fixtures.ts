import { computeBounds, computePositionsBounds, type Part } from "../../src/geometry/part";
import { identity, translation } from "../../src/math/mat4";
import { createCamera, viewProjectionMatrix } from "../../src/camera/camera";
import type { Assembly, Placement } from "../../src/scene/assembly";
import type { Scene } from "../../src/scene/scene";
import type { ChunkData, ChunkSource, LodChunkSource } from "../../src/streaming/chunk";
import type { AssemblyId, PartId } from "../../src/scene/types";

/**
 * Deterministic benchmark model sizes. These are fixed so measurements stay
 * comparable across runs; change them together with the budgets in
 * `budget.test.ts` and the note in `wiki/benchmarks.md`.
 */
export const BENCH_PART_COUNT = 200;
export const BENCH_SUBCASE_COUNT = 100;
export const BENCH_PLACEMENTS_PER_SUBCASE = 2_000;
/** Shallow model: root -> subcase -> part placements. */
export const BENCH_INSTANCE_COUNT = BENCH_SUBCASE_COUNT * BENCH_PLACEMENTS_PER_SUBCASE;
/** Deep balanced tree: fanout^depth leaves, each with `partsPerLeaf` parts. */
export const BENCH_HIERARCHY_DEPTH = 4;
export const BENCH_HIERARCHY_FANOUT = 8;
export const BENCH_HIERARCHY_PARTS_PER_LEAF = 50;
export const BENCH_HIERARCHY_INSTANCE_COUNT =
  BENCH_HIERARCHY_FANOUT ** BENCH_HIERARCHY_DEPTH * BENCH_HIERARCHY_PARTS_PER_LEAF;
/** Streaming model: evenly spaced chunks, each with a fixed vertex budget. */
export const BENCH_CHUNK_COUNT = 500;
export const BENCH_CHUNK_VERTICES_PER_CHUNK = 6_000;
export const BENCH_CHUNK_VERTEX_COUNT = BENCH_CHUNK_COUNT * BENCH_CHUNK_VERTICES_PER_CHUNK;

function part(id: PartId): Part {
  const geometry = {
    positions: new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0, 0.5, 0]),
    indices: new Uint32Array([0, 1, 2]),
  };
  return { id, geometry, bounds: computeBounds(geometry) };
}

function partMap(count: number): ReadonlyMap<PartId, Part> {
  const parts = new Map<PartId, Part>();
  for (let id = 1; id <= count; id++) {
    parts.set(id, part(id));
  }
  return parts;
}

/**
 * Deterministic part placements cycling over `partCount` parts. The transform
 * spreads instances along x so they do not alias within the default frustum.
 */
function partPlacements(count: number, partCount: number, row: number): Placement[] {
  const placements: Placement[] = [];
  for (let i = 0; i < count; i++) {
    placements.push({
      kind: "part",
      partId: (i % partCount) + 1,
      transform: translation(i * 0.001, row, 0),
    });
  }
  return placements;
}

/** A shallow model: root -> subcase assemblies -> part placements. */
export function makeScene(options: {
  readonly subcaseCount: number;
  readonly placementsPerSubcase: number;
  readonly partCount: number;
}): Scene {
  const { subcaseCount, placementsPerSubcase, partCount } = options;
  const parts = partMap(partCount);
  const assemblies = new Map<AssemblyId, Assembly>();
  const rootPlacements: Placement[] = [];
  for (let subcase = 0; subcase < subcaseCount; subcase++) {
    const subcaseId = subcase + 2;
    const subcaseAssembly: Assembly = {
      id: subcaseId,
      placements: partPlacements(placementsPerSubcase, partCount, subcase),
    };
    assemblies.set(subcaseId, subcaseAssembly);
    rootPlacements.push({
      kind: "assembly",
      assemblyId: subcaseId,
      transform: identity(),
    });
  }
  assemblies.set(1, { id: 1, placements: rootPlacements });
  return {
    rootAssemblyId: 1,
    parts,
    assemblies,
    visiblePartIds: new Set(parts.keys()),
    visibleAssemblyIds: new Set(assemblies.keys()),
  };
}

/**
 * A deep balanced assembly tree exercising nested transform composition:
 * internal nodes place `fanout` sub-assemblies and leaf nodes place
 * `partsPerLeaf` parts.
 */
export function makeHierarchyScene(options: {
  readonly depth: number;
  readonly fanout: number;
  readonly partsPerLeaf: number;
  readonly partCount: number;
}): Scene {
  const { depth, fanout, partsPerLeaf, partCount } = options;
  const parts = partMap(partCount);
  const assemblies = new Map<AssemblyId, Assembly>();
  let nextId = 1;
  const buildNode = (currentDepth: number, nodeId: AssemblyId): void => {
    const placements: Placement[] = [];
    if (currentDepth === 0) {
      for (let i = 0; i < partsPerLeaf; i++) {
        placements.push({
          kind: "part",
          partId: (i % partCount) + 1,
          transform: translation(i * 0.01, 0, 0),
        });
      }
    } else {
      for (let i = 0; i < fanout; i++) {
        const childId = nextId;
        nextId += 1;
        placements.push({ kind: "assembly", assemblyId: childId, transform: translation(i, 0, 0) });
        buildNode(currentDepth - 1, childId);
      }
    }
    assemblies.set(nodeId, { id: nodeId, placements });
  };
  const rootId = nextId;
  nextId += 1;
  buildNode(depth, rootId);
  return {
    rootAssemblyId: rootId,
    parts,
    assemblies,
    visiblePartIds: new Set(parts.keys()),
    visibleAssemblyIds: new Set(assemblies.keys()),
  };
}

/** A deterministic view-projection matrix for culling benchmarks. */
export function makeViewProjection(): Float32Array {
  return viewProjectionMatrix(createCamera());
}

/**
 * Deterministic streaming chunks: each chunk is a line of `verticesPerChunk`
 * vertices along x, spaced `spacing` apart so chunks are cullable against the
 * default frustum. Bounds are precomputed to model the common pre-indexed
 * model-authority case.
 */
export function makeChunkSources(options: {
  readonly chunkCount: number;
  readonly verticesPerChunk: number;
  readonly spacing?: number;
}): readonly ChunkSource[] {
  const spacing = options.spacing ?? 1;
  const chunks: ChunkSource[] = [];
  for (let chunk = 0; chunk < options.chunkCount; chunk++) {
    const base = chunk * options.verticesPerChunk * spacing;
    const { data, bounds } = lineData(base, options.verticesPerChunk);
    chunks.push({
      chunkId: chunk + 1,
      index: chunk,
      data,
      bounds,
    });
  }
  return chunks;
}

/**
 * Deterministic mixed-detail streaming chunks: each chunk carries three detail
 * levels with `verticesPerChunk`, half, and quarter vertices (finest to
 * coarsest). Detail selection over these chunks exercises the LOD path with
 * the same geometry shape as {@link makeChunkSources}.
 */
export function makeLodChunkSources(options: {
  readonly chunkCount: number;
  readonly verticesPerChunk: number;
  readonly spacing?: number;
}): readonly LodChunkSource[] {
  const spacing = options.spacing ?? 1;
  const chunks: LodChunkSource[] = [];
  for (let chunk = 0; chunk < options.chunkCount; chunk++) {
    const base = chunk * options.verticesPerChunk * spacing;
    const details = [
      options.verticesPerChunk,
      Math.floor(options.verticesPerChunk / 2),
      Math.floor(options.verticesPerChunk / 4),
    ].map((vertexCount) => lineData(base, vertexCount));
    chunks.push({ chunkId: chunk + 1, index: chunk, details });
  }
  return chunks;
}

function lineData(
  base: number,
  vertexCount: number,
): { data: ChunkData; bounds: ReturnType<typeof computePositionsBounds> } {
  const positions = new Float32Array(vertexCount * 3);
  const indices = new Uint32Array(vertexCount);
  for (let vertex = 0; vertex < vertexCount; vertex++) {
    positions[vertex * 3] = base + vertex;
    positions[vertex * 3 + 1] = 0;
    positions[vertex * 3 + 2] = 0;
    indices[vertex] = vertex;
  }
  return { data: { positions, indices }, bounds: computePositionsBounds(positions) };
}
