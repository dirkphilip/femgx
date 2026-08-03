# Performance issues and risks

This note records the remaining scalability risks after the first WebGPU renderer.

## Stable instance identity

`flattenAssembly` assigns a compact visible `index` after visibility culling.
Hiding or showing an earlier placement can change that draw index, so GPU picking
and incremental per-instance updates use the separate path-derived `instanceId`.

## Scene update cost

`SceneBuilder` copies maps and visibility sets for each builder operation. This
is convenient for small scenes, but repeated additions or visibility changes
copy O(n) state and can become quadratic while authoring large models. A packed
runtime representation, batch construction, and a delta-oriented update path are
needed for very large assemblies.

## Flattening cost

`flattenAssembly` allocates a matrix for every visited placement and creates a new
instance object for every visible placement. It now uses an iterative walk,
deterministic per-part batching, and optional frustum culling; transform caching,
dirty-subtree propagation, and packed authoring storage remain future work for
keeping frame work proportional to changed state.

## Matrix layout correctness

Resolved: `Mat4` multiplication and point transforms use column-major indexing,
with rotation/scale coverage in `test/mat4.test.ts`.

## Renderer and validation gaps

The renderer, GPU instance buffers, GPU picking, and resource lifecycle are now
implemented and mocked in unit tests. Remaining work is subrange delta updates,
packed runtime storage, benchmarks, and WebGPU-capable browser coverage.

## Toolchain reproducibility

CI and the project declaration now require Node 24; Node 21 is unsupported by
the current Vite/Rolldown toolchain.
