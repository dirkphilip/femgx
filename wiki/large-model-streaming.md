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

## Budgets

`test/bench/budget.test.ts` covers `parseChunk`, `buildSpatialGrid`,
`cullChunks`, and a full `createChunkStream` load at 500 chunks / 3M vertices
(see [[benchmarks|Benchmarks]]). Backpressure is the per-tick upload budget;
`ChunkStream.uploadedBytes` and `pendingBytes` expose the memory ledger, and
`dispose()` makes eviction predictable.

Related: [[instancing-strategy|Instancing strategy]], [[packed-runtime|Packed
scene runtime]], [[todo|Engineering TODO]].
