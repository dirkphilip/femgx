# Performance issues and risks

This note records the remaining scalability risks after the first WebGPU renderer.

## Stable instance identity

`flattenAssembly` assigns a compact visible `index` after visibility culling.
Hiding or showing an earlier placement can change that draw index, so GPU picking
and incremental per-instance updates use the separate path-derived `instanceId`.
The [[packed-runtime|packed scene runtime]] adds a third, fully packed handle: a
stable numeric instance slot over the whole placement list that never changes
across visibility updates.

## Scene update cost

_Resolved for visibility by the [[packed-runtime|packed scene runtime]]_: the
runtime flips packed visibility bits in place and reports deltas, so hide/show
cost is proportional to the changed placements instead of the whole model.

`SceneBuilder` copies maps and visibility sets for each builder operation. This
is convenient for small scenes, but repeated additions or visibility changes
copy O(n) state and can become quadratic while authoring large models. A packed
runtime representation, batch construction, and a delta-oriented update path are
needed for very large assemblies.

## Flattening cost

`flattenAssembly` allocates a matrix for every visited placement and creates a new
instance object for every visible placement. It now uses an iterative walk,
deterministic per-part batching, and optional frustum culling. The packed scene
runtime keeps authoring storage in typed arrays and updates visibility in place;
transform edits now recompose world transforms only within the affected subtree
(see [[packed-runtime|Packed scene runtime]]), keeping frame work proportional to
changed state.

## Matrix layout correctness

Resolved: `Mat4` multiplication and point transforms use column-major indexing,
with rotation/scale coverage in `test/mat4.test.ts`.

## Renderer and validation gaps

The renderer is split into focused modules under `src/renderer/` (see
[[source-organization|Source organization]]): `gpu-pipelines.ts` owns pipeline and
resource creation, `gpu-draw.ts` owns per-part geometry/instance buffers and draw
submission, and `gpu-pick.ts` owns the pick targets and readback, with
`gpu-renderer.ts` as a thin orchestrator. GPU instance buffers, picking, and
resource lifecycle are mocked in CPU-only unit tests. Remaining work is GPU
subrange delta updates wired to the packed runtime's visibility deltas,
benchmarks, and WebGPU-capable browser coverage.

### Remaining GPU allocation risks

`gpu-draw.ts` `drawBatches` allocates a new bind group per batch on every frame
and `render` re-creates a depth texture each frame; these per-frame allocations
conflict with the instancing performance goal and should be cached/reused (e.g.
bind groups keyed by batch resource, and a resized depth texture). The pick
targets are already reused across frames and resized on demand, and per-part
instance buffers only grow. `readPickPixel` also allocates a fresh readback
buffer and `mapAsync` per call, which stalls on the queue until mapped; a pooled
readback buffer would remove that per-pick allocation.

## Toolchain reproducibility

The repository pins Node 24.18.0 in `.nvmrc`, and the package engine declaration
uses a full semver lower bound so local tooling and Supervisor can select a
compatible Node runtime. Node 21 is unsupported by the current Vite/Rolldown
toolchain.
