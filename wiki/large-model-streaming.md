# Large-model streaming, spatial partitioning, and coordinate rebasing

Issue #58. The `src/streaming/` subsystem makes hundreds-of-millions-scale
models practical by loading, culling, and uploading geometry in chunks instead
of as one monolithic part.

## Pipeline

A chunked model is a list of `ChunkSource`s. Each source carries raw geometry
(`ChunkData`), a stable `chunkId`, a model-authority `index`, and optional
precomputed world bounds. The pipeline is:

1. **Parse** — `parseChunk` validates the index buffer, validates element
   coverage, computes world bounds, and applies local-origin rebasing
   (`ParseChunkOptions.origin`). It is a pure function over typed arrays, so it
   can run on a worker thread; `chunkTransferables` returns the buffers to put
   on a postMessage transfer list so parsed geometry moves without copying.
2. **Partition** — `buildSpatialGrid` bins chunks by their bounds center into a
   uniform grid, and `cullChunks` rejects whole off-screen cells before
   checking individual chunk bounding spheres, so hidden/off-screen chunks
   never reach the upload path.
3. **Stream** — `createChunkStream` is a deterministic, budgeted pump: chunks
   are emitted strictly in model order, hidden/off-screen chunks are skipped
   (never uploaded), a per-tick byte budget defers large work to the next tick
   (backpressure), an `AbortSignal` or `cancel()` cancels, and `dispose()`
   releases pending chunk buffers.

`partFromChunk` converts a parsed chunk into the existing `Part` type so a
consumer can feed it to the scene builder / renderer as it arrives, giving
progressive rendering.

## Deterministic ordering

Streaming and culling both sort by ascending `index`, with `chunkId` breaking
ties (`compareChunks`). A chunk list produced by `cullChunks` feeds a stream in
the exact order the stream emits it, which keeps GPU upload order and pick
identity stable frame to frame.

## Coordinate rebasing

Large FE models are often placed far from the world origin (UTM eastings,
project datums). float32 can only represent sub-ulp detail near zero, so a
6 000 000 m coordinate cannot also carry a 0.25 m feature. The rebase strategy:

- `computeLocalOrigin(chunks)` picks the bounding-box center of the whole model.
- `rebasePositions` subtracts that origin **from double-precision input before
  rounding to float32**, preserving detail that a naive float32 copy loses.
- `parseChunk(source, { origin })` applies the same rebase to positions and
  bounds, and returns GPU-ready float32 positions.

This is the documented **local-origin** strategy. A 64-bit/global-coordinate
strategy (float64 vertex positions) is out of scope for current WebGPU — see
[[performance-issues|Performance issues]] and the issue tracker.

## Level-of-detail chunk variants

Issue #76. Chunks can carry an ordered list of detail levels (`LodChunkSource`),
finest first, each with its own positions/indices/bounds (`LodDetail`). Detail
selection hangs off the uniform grid:

- `buildSpatialGrid` accepts `LodChunkSource` alongside plain chunks; cells and
  culling are keyed to the **finest** detail's bounds so coarse variants are
  never more visible than the full geometry.
- `cullChunks(grid, viewProjection, { cameraPosition, detailThresholds })`
  measures each **cell's** distance from the camera and resolves every chunk in
  the cell to the detail level chosen by `detailIndexForDistance` (level 0 is
  finest; each threshold crossed steps one level coarser). The result is a
  stream-ready list of single-detail `ChunkSource`s, preserving chunk id/index
  so pick identity and stream order are detail-independent.
- Without `cameraPosition`, LOD chunks resolve to their finest detail, so the
  cull API is backwards compatible.

The stream itself is unchanged: it only ever sees resolved single-detail
sources, so "defer fine geometry" is expressed as _which_ variant each chunk
resolves to at cull time, not as stream state.

## Budgets

`test/bench/budget.test.ts` covers `parseChunk`, `buildSpatialGrid`,
`cullChunks`, and a full `createChunkStream` load at 500 chunks / 3M vertices,
plus mixed-detail `parseChunk` and `createChunkStream` cases over 500 LOD
chunks (see [[benchmarks|Benchmarks]]). Backpressure is the per-tick upload
budget; `ChunkStream.uploadedBytes` and `pendingBytes` expose the memory
ledger, and `dispose()` makes eviction predictable.

Related: [[instancing-strategy|Instancing strategy]], [[packed-runtime|Packed
scene runtime]], [[todo|Engineering TODO]].
