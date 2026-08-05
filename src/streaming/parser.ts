import { computePositionsBounds, validateElements, type Bounds } from "../geometry/part";
import type { ChunkData, ChunkSource, ParsedChunk } from "./chunk";
import { rebaseBounds, rebasePositions, type RebaseOrigin } from "./rebase";

/** Options controlling how a chunk payload is parsed. */
export interface ParseChunkOptions {
  /** Local origin subtracted from all vertices; see `wiki/large-model-streaming.md`. */
  readonly origin?: RebaseOrigin;
}

/**
 * Parses a chunk: validates its index buffer, computes (or carries) its world
 * bounds, and applies local-origin rebasing when requested. The result is
 * worker-compatible — positions and indices are transferable typed arrays, so
 * a worker thread can post a parsed chunk to the main thread without copying
 * (see {@link chunkTransferables}).
 */
export function parseChunk(source: ChunkSource, options: ParseChunkOptions = {}): ParsedChunk {
  validateChunkData(source.data);
  if (source.data.elements !== undefined) {
    validateElements(source.data);
  }
  const origin = options.origin;
  const positions =
    origin === undefined
      ? toFloat32(source.data.positions)
      : rebasePositions(source.data.positions, origin);
  return {
    chunkId: source.chunkId,
    index: source.index,
    positions,
    indices: source.data.indices,
    bounds: parseBounds(source, origin),
    ...(source.data.elements === undefined ? {} : { elements: source.data.elements }),
  };
}

/**
 * The buffers that must appear in a worker message transfer list when posting
 * a parsed chunk, so the buffers move instead of being copied.
 */
export function chunkTransferables(chunk: ParsedChunk): readonly ArrayBufferLike[] {
  return [chunk.positions.buffer, chunk.indices.buffer];
}

/**
 * Throws when a chunk's indices or positions are structurally invalid: indices
 * must reference vertices inside the positions, and every position component
 * must be finite. Rejecting NaN/Infinity here is what keeps garbage data from
 * silently corrupting bounds, culling, and rebasing downstream.
 */
export function validateChunkData(data: ChunkData): void {
  const vertexCount = data.positions.length / 3;
  if (!Number.isInteger(vertexCount)) {
    throw new Error(`Chunk positions length ${data.positions.length} is not a multiple of 3`);
  }
  for (let i = 0; i < data.indices.length; i++) {
    const index = data.indices[i];
    if (index === undefined || index >= vertexCount) {
      throw new Error(`Chunk index ${String(index)} is out of range (vertex count ${vertexCount})`);
    }
  }
  for (let i = 0; i < data.positions.length; i++) {
    if (!Number.isFinite(data.positions[i])) {
      throw new Error(
        `Chunk position ${Math.floor(i / 3)} component ${i % 3} is not finite: ${String(
          data.positions[i],
        )}`,
      );
    }
  }
}

function parseBounds(source: ChunkSource, origin: RebaseOrigin | undefined): Bounds {
  const bounds =
    source.bounds === undefined ? computePositionsBounds(source.data.positions) : source.bounds;
  return origin === undefined ? bounds : rebaseBounds(bounds, origin);
}

function toFloat32(positions: Float32Array | Float64Array): Float32Array {
  return positions instanceof Float32Array ? positions : Float32Array.from(positions);
}
