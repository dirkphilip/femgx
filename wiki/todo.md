# Engineering TODO

Prioritized roadmap for high-performance assemblies and a modern WebGPU
development workflow.

## P0 — correctness and runtime foundation

- [x] Fix column-major `Mat4` multiplication and add rotation, scale, and nested
      transform tests.
- [x] Define persistent placement and instance handles that do not change when
      visibility changes; keep draw-list compaction separate from pick identity.
- [x] Add assembly validation for duplicate IDs, missing references, cycles, and
      invalid roots.
- [x] Replace recursive flattening with an iterative compiled hierarchy that is
      safe for deeply nested models.

## P1 — scalable assembly runtime

- [x] Compile authoring maps into packed typed-array storage for placements,
      parents, transforms, visibility, and instance metadata (see
      [[packed-runtime|Packed scene runtime]]).
- [x] Add dirty-subtree transform propagation so unchanged branches are not
      re-flattened or re-multiplied (see
      [[packed-runtime|Packed scene runtime]]).
- [x] Make visibility updates delta-based with bitsets or ranges; avoid copying
      whole maps and sets for each hide/show operation (see
      [[packed-runtime|Packed scene runtime]]).
- [x] Batch visible instances by part while preserving stable instance handles.
- [x] Add bounds-based frustum culling and measure its CPU/GPU trade-offs.

## P1 — WebGPU renderer

- [x] Implement device/context initialization and explicit resource lifecycle.
- [x] Define the instance-buffer layout for transforms, style state, visibility,
      and pick IDs.
- [x] Upload each part's geometry once and issue instanced draws grouped by part.
- [ ] Add buffer subrange updates for transform and interaction deltas.
- [x] Add a pick render pass and asynchronous single-pixel readback.
- [x] Split the renderer into focused modules (pipelines, draw, pick readback)
      below the 300-line limit (see [[source-organization|Source organization]]).

## P2 — interaction API

- [x] Add centralized part-level and instance-level selection, highlight, hover,
      and visibility state.
- [x] Define precedence when part and instance styles overlap.
- [x] Expose a clean `pick(x, y)` API returning stable part/instance targets.

## P2 — modern development workflow

- [ ] Add a deterministic procedural FE example dataset with nested assemblies,
      repeated parts, documented dimensions, and a checked-in fixture or generator.
- [x] Build a demo assembly viewer with orbit, pan, zoom, reset, and camera
      state exposed through a small testable API.
- [x] Support orthographic and perspective projections with explicit camera
      tests for projection, clipping, and resize behavior.
- [x] Add Playwright tests for initial
      rendering, projection changes, pointer controls, reset, and no-WebGPU fallback.
- [ ] Add benchmarks for hierarchy compilation, updates, draw batching, and
      picking at representative model sizes.
- [ ] Add performance budgets and regression checks to CI.
- [x] Align the supported Node version across `package.json`, CI, and docs.
- [ ] Add WebGPU-capable browser coverage to the demo/e2e strategy, with a CPU
      fallback for environments without WebGPU.

Related: [[performance-issues|Performance issues and risks]],
[[instancing-strategy|Instancing strategy]], and
[[interactive-state|Interactive state]].
