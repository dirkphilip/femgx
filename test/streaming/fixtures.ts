import { computeBounds } from "../../src/geometry/part";
import type { ChunkSource, LodChunkSource } from "../../src/streaming/chunk";

/**
 * A deterministic quad chunk centered at `x` in world space. Each chunk owns a
 * 4-vertex / 6-index quad so byte budgets are predictable (72 bytes of
 * payload).
 */
export function quadChunk(chunkId: number, index: number, x: number): ChunkSource {
  const positions = new Float32Array([
    x - 0.5,
    -0.5,
    0,
    x + 0.5,
    -0.5,
    0,
    x + 0.5,
    0.5,
    0,
    x - 0.5,
    0.5,
    0,
  ]);
  const indices = new Uint32Array([0, 1, 2, 0, 2, 3]);
  return {
    chunkId,
    index,
    data: { positions, indices },
    bounds: computeBounds({ positions, indices }),
  };
}

/**
 * A deterministic LOD chunk carrying `vertexCounts` detail levels, from finest
 * to coarsest. Each level is a line of that many vertices along x near `x` so
 * detail selection is observable by index-buffer length.
 */
export function lodLineChunk(
  chunkId: number,
  index: number,
  x: number,
  vertexCounts: readonly number[] = [4, 2],
): LodChunkSource {
  return {
    chunkId,
    index,
    details: vertexCounts.map((count) => lineData(x, count)),
  };
}

function lineData(x: number, vertexCount: number): Pick<ChunkSource, "data" | "bounds"> {
  const positions = new Float32Array(vertexCount * 3);
  const indices = new Uint32Array(vertexCount);
  for (let vertex = 0; vertex < vertexCount; vertex++) {
    positions[vertex * 3] = x + vertex;
    positions[vertex * 3 + 1] = 0;
    positions[vertex * 3 + 2] = 0;
    indices[vertex] = vertex;
  }
  return {
    data: { positions, indices },
    bounds: computeBounds({ positions, indices }),
  };
}
