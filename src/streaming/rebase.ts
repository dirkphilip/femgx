import { computePositionsBounds, type Bounds } from "../geometry/part";
import type { ChunkSource } from "./chunk";
import { isFiniteBounds } from "./finite";

/**
 * A local model origin. Rebasing subtracts this point from every vertex so
 * that float32 GPU/CPU buffers keep near-origin precision even when the model
 * is placed far from the world origin (see `wiki/large-model-streaming.md`).
 */
export type RebaseOrigin = readonly [number, number, number];

/**
 * Subtracts a local origin from every vertex, returning a new float32 buffer.
 * Accepting double-precision input means the arithmetic happens before the
 * coordinates are rounded to float32, which is what preserves detail in large
 * models (see `wiki/large-model-streaming.md`).
 */
export function rebasePositions(
  positions: Float32Array | Float64Array,
  origin: RebaseOrigin,
): Float32Array {
  const rebased = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    rebased[i] = (positions[i] ?? 0) - origin[0];
    rebased[i + 1] = (positions[i + 1] ?? 0) - origin[1];
    rebased[i + 2] = (positions[i + 2] ?? 0) - origin[2];
  }
  return rebased;
}

/** Translates an axis-aligned bounds by a local origin. */
export function rebaseBounds(bounds: Bounds, origin: RebaseOrigin): Bounds {
  return {
    minX: bounds.minX - origin[0],
    minY: bounds.minY - origin[1],
    minZ: bounds.minZ - origin[2],
    maxX: bounds.maxX - origin[0],
    maxY: bounds.maxY - origin[1],
    maxZ: bounds.maxZ - origin[2],
  };
}

/**
 * Picks a local origin near the model's overall bounding-box center so the
 * rebased coordinates stay as small as possible. The result is deterministic
 * for a given chunk list. Chunks without precomputed bounds have their bounds
 * computed from their data. Chunks whose bounds are not finite (a NaN/Infinity
 * component in an untrusted precomputed bounds) are skipped, so one corrupt
 * chunk cannot poison the origin for the whole model; the corrupt chunk itself
 * is rejected loudly by `parseChunk`.
 */
export function computeLocalOrigin(chunks: readonly ChunkSource[]): RebaseOrigin {
  const overall = unionBounds(chunks.map(chunkBounds));
  return [
    (overall.minX + overall.maxX) / 2,
    (overall.minY + overall.maxY) / 2,
    (overall.minZ + overall.maxZ) / 2,
  ];
}

function chunkBounds(source: ChunkSource): Bounds {
  return source.bounds === undefined
    ? computePositionsBounds(source.data.positions)
    : source.bounds;
}

function unionBounds(bounds: readonly Bounds[]): Bounds {
  return bounds.filter(isFiniteBounds).reduce(
    (union, current) => ({
      minX: Math.min(union.minX, current.minX),
      minY: Math.min(union.minY, current.minY),
      minZ: Math.min(union.minZ, current.minZ),
      maxX: Math.max(union.maxX, current.maxX),
      maxY: Math.max(union.maxY, current.maxY),
      maxZ: Math.max(union.maxZ, current.maxZ),
    }),
    {
      minX: Infinity,
      minY: Infinity,
      minZ: Infinity,
      maxX: -Infinity,
      maxY: -Infinity,
      maxZ: -Infinity,
    },
  );
}
