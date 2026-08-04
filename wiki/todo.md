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
- [x] Add buffer subrange updates for transform and interaction deltas (see
      [[renderer-subrange-updates|Renderer subrange updates]]).
- [x] Add a pick render pass and asynchronous single-pixel readback.
- [x] Cache per-frame GPU resources: bind groups per batch, a resized depth
      texture, and a pooled pick readback (see
      [[webgpu-resource-reuse|WebGPU resource reuse]]).
- [x] Split the renderer into focused modules (pipelines, draw, pick readback)
      below the 300-line limit (see [[source-organization|Source organization]]).
- [x] Encode emissive into the GPU instance record so hover/highlight themes
      take effect on the WebGPU path, matching the CPU fallback (see
      [[renderer-subrange-updates|Renderer subrange updates]]).

## P2 — interaction API

- [x] Add centralized part-level and instance-level selection, highlight, hover,
      and visibility state.
- [x] Define precedence when part and instance styles overlap.
- [x] Expose a clean `pick(x, y)` API returning stable part/instance targets.

## P2 — modern development workflow

- [x] Add a deterministic procedural FE example dataset with nested assemblies,
      repeated parts, documented dimensions, and a checked-in fixture or generator
      (see [[fe-fixture|FE fixture]]).
- [x] Build a demo assembly viewer with orbit, pan, zoom, reset, and camera
      state exposed through a small testable API.
- [x] Support orthographic and perspective projections with explicit camera
      tests for projection, clipping, and resize behavior.
- [x] Add Playwright tests for initial
      rendering, projection changes, pointer controls, reset, and no-WebGPU fallback.
- [x] Add benchmarks for hierarchy compilation, updates, draw batching, and
      picking at representative model sizes (see [[benchmarks|Benchmarks]]).
- [x] Add performance budgets and regression checks to CI (see
      [[benchmarks|Benchmarks]]).
- [x] Align the supported Node version across `package.json`, CI, and docs.
- [x] Add WebGPU-capable browser coverage to the demo/e2e strategy, with a CPU
      fallback for environments without WebGPU (see
      [[webgpu-e2e|WebGPU browser e2e lane]]).

## P2 — element topology

- [x] Add a typed finite-element model with point, line, Tet4/Tet10, Hex8/Hex20
      shapes, canonical VTK node ordering, and connectivity validation (see
      [[elements-topology|Element topology]]).
- [x] Extract oriented polygon faces (with quadratic mid-edge nodes) and unique
      element edges, with canonical-key deduplication and boundary/interior
      face classification (see [[elements-topology|Element topology]]).
- [x] Render linear and quadratic elements (points, lines, and element edges)
      as triangle/line/point primitives, with boundary-face and edge-dedup
      culling, quadratic mid-edge tessellation, and a mode-toggle demo (see
      [[element-rendering|Element rendering]]).

## P2 — engineering results

- [x] Add typed nodal/elemental scalar, vector, and symmetric tensor fields
      with stable ids, units, and `NaN` missing-value conventions (see
      [[results|Results]]).
- [x] Add derived quantities: magnitude, tensor magnitude, von Mises, and
      principal values, plus per-entity field helpers and derived scalar
      fields.
- [x] Add finite-value ranges that ignore missing data.
- [x] Add scalar color mapping with ranges, gradient stops, thresholds
      (discrete bands), clipping, and missing-value colors, plus legend
      entries.
- [x] Add deformed-shape geometry from a nodal displacement field with a
      configurable scale.
- [x] Demonstrate undeformed/deformed shape and scalar (von Mises)
      visualization with load-case stepping in the CPU results demo and
      deterministic e2e coverage.
- [x] Add a dedicated load-case playback API (`CasePlayer`) with configurable
      case duration, wrap/clamp looping, and optional displacement
      interpolation between adjacent cases (see [[results|Results]]).
- [x] GPU-side deformed rendering (per-instance vertex displacement) via
      `setDeformation` + `nodalDisplacements` (see [[results|Results]]).

## Improvement work items

- [x] Render pick ids into a universally reliable format (`rgba8unorm` with the
      id packed across the RGBA channels) instead of `r32uint`, whose SwiftShader
      readback proved unreliable; see [[pick-format|Pick texture format]].

## P3 — large-model streaming

- [x] Add chunked model loading: parse, validate, and bound geometry per chunk
      (see [[large-model-streaming|Large-model streaming]]).
- [x] Add uniform-grid spatial partitioning and frustum chunk culling so
      hidden/off-screen chunks avoid GPU upload and draw work.
- [x] Add a deterministic, budgeted upload stream with backpressure,
      cancellation, and disposal.
- [x] Add local-origin coordinate rebasing that preserves sub-float32 detail
      from double-precision model data.
- [ ] Wire worker-thread parsing into `createChunkStream` (the parser is pure
      and transferable; a thread host needs bundling support; see #57).
- [x] Add level-of-detail (coarse/fine chunk variants) to the stream (#76).
- [x] Feed streamed chunks directly into the WebGPU renderer so geometry
      uploads progressively without a full draw-resource rebuild (#77).

Related: [[performance-issues|Performance issues and risks]],
[[instancing-strategy|Instancing strategy]], and
[[interactive-state|Interactive state]].
