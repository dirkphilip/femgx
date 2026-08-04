import type { Bounds, ElementTessellation, Part } from "../geometry/part";
import type { PartId } from "../scene/types";

/**
 * Stable identifier of one model chunk. Chunk ids are unique within a model
 * and are the unit of streaming: a chunk is uploaded, culled, and disposed
 * atomically.
 */
export type ChunkId = number;

/**
 * Raw geometry data of one chunk. The typed arrays are the transferable unit
 * of the streaming protocol: after parsing they can be posted to a worker or
 * moved into a GPU buffer without copying. Positions may arrive as doubles
 * (model files store coordinates that way); parsing converts them to
 * near-origin float32 so GPU buffers keep precision.
 */
export interface ChunkData {
  readonly positions: Float32Array | Float64Array;
  readonly indices: Uint32Array;
  readonly elements?: readonly ElementTessellation[];
}

/**
 * Describes one region of a large model before it is parsed. The stream
 * processes sources in ascending {@link ChunkSource.index} order, so `index`
 * is the model-authority ordering and `chunkId` only breaks index ties.
 */
export interface ChunkSource {
  readonly chunkId: ChunkId;
  /** Ordinal of this chunk in the model; the stream emits in this order. */
  readonly index: number;
  readonly data: ChunkData;
  /** Optional precomputed world bounds; computed from data when absent. */
  readonly bounds?: Bounds;
}

/** A chunk after parsing: validated, bounded, and optionally rebased. */
export interface ParsedChunk {
  readonly chunkId: ChunkId;
  readonly index: number;
  /** GPU-ready positions: float32, rebased near the local origin. */
  readonly positions: Float32Array;
  readonly indices: Uint32Array;
  readonly bounds: Bounds;
  readonly elements?: readonly ElementTessellation[];
}

/**
 * One detail level of a {@link LodChunkSource}. Levels are ordered
 * finest-first: `details[0]` is the full-fidelity geometry and higher indexes
 * are progressively coarser variants (fewer vertices/indices) used when the
 * chunk is distant from the camera.
 */
export interface LodDetail {
  readonly data: ChunkData;
  /** Optional precomputed world bounds for this detail; computed when absent. */
  readonly bounds?: Bounds;
}

/**
 * A chunk that carries an ordered list of detail levels, from finest to
 * coarsest. Detail selection happens at cull time, which resolves the source
 * to a single-detail {@link ChunkSource}. The chunk id and index are shared by
 * every detail level, so pick identity and stream ordering are
 * detail-independent.
 */
export interface LodChunkSource {
  readonly chunkId: ChunkId;
  /** Ordinal of this chunk in the model; the stream emits in this order. */
  readonly index: number;
  readonly details: readonly LodDetail[];
}

/** Narrowing guard: true when `source` carries ordered detail levels. */
export function isLodChunkSource(source: ChunkSource | LodChunkSource): source is LodChunkSource {
  return "details" in source;
}

/**
 * Resolves a {@link LodChunkSource} to a single-detail {@link ChunkSource}
 * carrying the `level`-th detail's data and bounds. Out-of-range levels clamp
 * to the nearest valid detail (negative to the finest, large to the coarsest).
 */
export function selectChunkDetail(source: LodChunkSource, level: number): ChunkSource {
  const detail = source.details[clampDetailLevel(level, source.details.length)];
  if (detail === undefined) {
    throw new Error(`LodChunkSource ${source.chunkId} has no detail levels`);
  }
  return {
    chunkId: source.chunkId,
    index: source.index,
    data: detail.data,
    ...(detail.bounds === undefined ? {} : { bounds: detail.bounds }),
  };
}

function clampDetailLevel(level: number, detailCount: number): number {
  const clamped = Math.min(Math.max(0, Math.floor(level)), detailCount - 1);
  return clamped < 0 ? -1 : clamped;
}

/** Total CPU footprint of a chunk's raw buffers, in bytes. */
export function chunkDataByteLength(data: ChunkData): number {
  return data.positions.byteLength + data.indices.byteLength;
}

/**
 * Deterministic model ordering: ascending chunk index, with chunk id breaking
 * index ties. Streaming and culling use this so a culled chunk list feeds a
 * stream in the same order the stream would emit it.
 */
export function compareChunks(a: ChunkSource, b: ChunkSource): number {
  return a.index - b.index || a.chunkId - b.chunkId;
}

/**
 * Converts a parsed chunk into a renderable part. `partId` defaults to the
 * chunk id, so a chunked model maps one chunk to one part.
 */
export function partFromChunk(chunk: ParsedChunk, partId: PartId = chunk.chunkId): Part {
  return {
    id: partId,
    geometry: {
      positions: chunk.positions,
      indices: chunk.indices,
      ...(chunk.elements === undefined ? {} : { elements: chunk.elements }),
    },
    bounds: chunk.bounds,
  };
}
