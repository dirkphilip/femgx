import { computePositionsBounds, type Bounds } from "../geometry/part";
import { extractFrustum, isSphereVisible, type Frustum } from "../runtime/culling";
import type { Mat4 } from "../math/mat4";
import { compareChunks, type ChunkId, type ChunkSource } from "./chunk";

/** One cell of the uniform spatial grid. */
export interface ChunkCell {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly bounds: Bounds;
  readonly chunkIds: readonly ChunkId[];
}

/**
 * A uniform grid that partitions chunk world bounds by their center. Cells are
 * stored in ascending (x, y, z) order so chunk enumeration is deterministic.
 */
export interface SpatialGrid {
  readonly cellSize: number;
  readonly cells: readonly ChunkCell[];
  readonly chunks: readonly ChunkSource[];
}

/**
 * Partitions chunks into a uniform grid so view culling can reject whole cells
 * before testing individual chunks. Chunks without precomputed bounds have
 * them computed from their data.
 */
export function buildSpatialGrid(chunks: readonly ChunkSource[], cellSize: number): SpatialGrid {
  if (!Number.isFinite(cellSize) || cellSize <= 0) {
    throw new Error("cellSize must be a positive finite number");
  }
  const cells = new Map<string, CellAccumulator>();
  for (const chunk of chunks) {
    const bounds = chunkBounds(chunk);
    const center = boundsCenter(bounds);
    const x = cellIndex(center[0], cellSize);
    const y = cellIndex(center[1], cellSize);
    const z = cellIndex(center[2], cellSize);
    const key = `${x},${y},${z}`;
    const cell = cells.get(key);
    if (cell === undefined) {
      cells.set(key, { x, y, z, bounds, chunkIds: [chunk.chunkId] });
    } else {
      cell.bounds = union(cell.bounds, bounds);
      cell.chunkIds.push(chunk.chunkId);
    }
  }
  return {
    cellSize,
    chunks,
    cells: Array.from(cells.values()).sort(compareCells),
  };
}

/**
 * Returns the chunks that intersect the view frustum, in deterministic chunk
 * index order. A cell whose bounding sphere is outside the frustum rejects all
 * of its chunks at once; surviving cells are checked chunk by chunk.
 */
export function cullChunks(grid: SpatialGrid, viewProjection: Mat4): readonly ChunkSource[] {
  const frustum = extractFrustum(viewProjection);
  const byId = new Map<ChunkId, ChunkSource>(
    grid.chunks.map((chunk): readonly [ChunkId, ChunkSource] => [chunk.chunkId, chunk]),
  );
  const visible = new Set<ChunkId>();
  for (const cell of grid.cells) {
    if (!isCellVisible(cell, frustum)) {
      continue;
    }
    for (const chunkId of cell.chunkIds) {
      const chunk = byId.get(chunkId);
      if (chunk !== undefined && isChunkVisible(chunk, frustum)) {
        visible.add(chunkId);
      }
    }
  }
  return grid.chunks.filter((chunk) => visible.has(chunk.chunkId)).sort(compareChunks);
}

interface CellAccumulator {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  bounds: Bounds;
  readonly chunkIds: ChunkId[];
}

function cellIndex(center: number, cellSize: number): number {
  return Math.floor(center / cellSize);
}

function compareCells(a: ChunkCell, b: ChunkCell): number {
  return a.x - b.x || a.y - b.y || a.z - b.z;
}

function chunkBounds(chunk: ChunkSource): Bounds {
  return chunk.bounds === undefined ? computePositionsBounds(chunk.data.positions) : chunk.bounds;
}

function boundsCenter(bounds: Bounds): readonly [number, number, number] {
  return [
    (bounds.minX + bounds.maxX) / 2,
    (bounds.minY + bounds.maxY) / 2,
    (bounds.minZ + bounds.maxZ) / 2,
  ];
}

function union(a: Bounds, b: Bounds): Bounds {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    minZ: Math.min(a.minZ, b.minZ),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
    maxZ: Math.max(a.maxZ, b.maxZ),
  };
}

function isChunkVisible(chunk: ChunkSource, frustum: Frustum): boolean {
  return isSphereVisible(
    frustum,
    boundsCenter(chunkBounds(chunk)),
    boundsRadius(chunkBounds(chunk)),
  );
}

function isCellVisible(cell: ChunkCell, frustum: Frustum): boolean {
  return isSphereVisible(frustum, boundsCenter(cell.bounds), boundsRadius(cell.bounds));
}

function boundsRadius(bounds: Bounds): number {
  return (
    Math.hypot(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, bounds.maxZ - bounds.minZ) / 2
  );
}
