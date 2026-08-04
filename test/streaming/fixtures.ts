import { computeBounds } from "../../src/geometry/part";
import type { ChunkSource } from "../../src/streaming/chunk";

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
