import { computePositionsBounds, type Bounds } from "../geometry/part";
import { extractFrustum, isSphereVisible, type Frustum } from "../runtime/culling";
import type { Mat4 } from "../math/mat4";
import {
  compareChunks,
  isLodChunkSource,
  selectChunkDetail,
  type ChunkId,
  type ChunkSource,
  type LodChunkSource,
} from "./chunk";
import { isFiniteBounds } from "./finite";

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
 * LOD chunks are represented by their finest detail's bounds.
 */
export interface SpatialGrid {
  readonly cellSize: number;
  readonly cells: readonly ChunkCell[];
  readonly chunks: readonly (ChunkSource | LodChunkSource)[];
}

/** Options controlling {@link cullChunks} and distance-based detail selection. */
export interface CullChunksOptions {
  /**
   * Camera position that per-cell detail distances are measured from. When
   * omitted, LOD chunks resolve to their finest detail.
   */
  readonly cameraPosition?: readonly [number, number, number];
  /**
   * Ascending distances at which the detail level steps down; see
   * {@link detailIndexForDistance}. When omitted, LOD chunks resolve to their
   * finest detail.
   */
  readonly detailThresholds?: readonly number[];
}

/**
 * Partitions chunks into a uniform grid so view culling can reject whole cells
 * before testing individual chunks. Chunks without precomputed bounds have
 * them computed from their data (the finest detail for LOD chunks).
 */
export function buildSpatialGrid(
  chunks: readonly (ChunkSource | LodChunkSource)[],
  cellSize: number,
): SpatialGrid {
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
 * of its chunks at once; surviving cells are checked chunk by chunk. LOD
 * chunks are resolved to the detail level selected by their cell's distance
 * from the camera (see {@link CullChunksOptions}), so the returned list is
 * stream-ready single-detail chunks.
 */
export function cullChunks(
  grid: SpatialGrid,
  viewProjection: Mat4,
  options: CullChunksOptions = {},
): readonly ChunkSource[] {
  const frustum = extractFrustum(viewProjection);
  const byId = new Map<ChunkId, ChunkSource | LodChunkSource>(
    grid.chunks.map((chunk): readonly [ChunkId, ChunkSource | LodChunkSource] => [
      chunk.chunkId,
      chunk,
    ]),
  );
  const visible: ChunkSource[] = [];
  const thresholds = options.detailThresholds ?? [];
  for (const cell of grid.cells) {
    if (!isCellVisible(cell, frustum)) {
      continue;
    }
    const level =
      options.cameraPosition === undefined
        ? 0
        : detailIndexForDistance(
            distance(boundsCenter(cell.bounds), options.cameraPosition),
            thresholds,
          );
    for (const chunkId of cell.chunkIds) {
      const chunk = byId.get(chunkId);
      if (chunk === undefined || !isChunkVisible(chunk, frustum)) {
        continue;
      }
      visible.push(resolveDetail(chunk, level));
    }
  }
  return visible.sort(compareChunks);
}

/**
 * Picks a detail level for a distance given ascending thresholds. Level 0 is
 * the finest detail; each threshold crossed steps one level coarser, and the
 * result is at most `thresholds.length`. An empty threshold list always
 * selects level 0.
 */
export function detailIndexForDistance(distance: number, thresholds: readonly number[]): number {
  let level = 0;
  for (const threshold of thresholds) {
    if (distance < threshold) {
      break;
    }
    level += 1;
  }
  return level;
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

function chunkBounds(chunk: ChunkSource | LodChunkSource): Bounds {
  if (isLodChunkSource(chunk)) {
    return lodFinestBounds(chunk);
  }
  return chunk.bounds === undefined ? computePositionsBounds(chunk.data.positions) : chunk.bounds;
}

function lodFinestBounds(source: LodChunkSource): Bounds {
  const detail = source.details[0];
  if (detail === undefined) {
    throw new Error(`LodChunkSource ${source.chunkId} has no detail levels`);
  }
  return detail.bounds === undefined
    ? computePositionsBounds(detail.data.positions)
    : detail.bounds;
}

function resolveDetail(chunk: ChunkSource | LodChunkSource, level: number): ChunkSource {
  return isLodChunkSource(chunk) ? selectChunkDetail(chunk, level) : chunk;
}

function boundsCenter(bounds: Bounds): readonly [number, number, number] {
  return [
    (bounds.minX + bounds.maxX) / 2,
    (bounds.minY + bounds.maxY) / 2,
    (bounds.minZ + bounds.maxZ) / 2,
  ];
}

function distance(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
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

function isChunkVisible(chunk: ChunkSource | LodChunkSource, frustum: Frustum): boolean {
  const bounds = chunkBounds(chunk);
  return isFiniteBounds(bounds)
    ? isSphereVisible(frustum, boundsCenter(bounds), boundsRadius(bounds))
    : true;
}

function isCellVisible(cell: ChunkCell, frustum: Frustum): boolean {
  return isFiniteBounds(cell.bounds)
    ? isSphereVisible(frustum, boundsCenter(cell.bounds), boundsRadius(cell.bounds))
    : true;
}

function boundsRadius(bounds: Bounds): number {
  return (
    Math.hypot(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, bounds.maxZ - bounds.minZ) / 2
  );
}
