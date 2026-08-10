# Engineering TODO

Prioritized roadmap for the minimum WebGPU product. Classifications follow the
[[requirements/product-scope|product scope contract]]: items below marked
**Deferred** are not requirements (code may stay, but must not grow), and items
marked **Remove** are scheduled for deletion behind an explicit product
decision. Checked items record what was built; the roadmap is not a mandate to
extend out-of-scope capability.

## Open-backlog scope map

This classification snapshot records the open backlog audited in issue #209.
GitHub issue state remains the work queue; this map makes the product-scope
decision visible without turning labels into a second process. Deferred issues
require a fresh decision-gate approval before implementation.

The current audit and closure rationale live in
[[engineering/issue-audit|Open issue audit]]. The canonical-workflow milestone
is deliberately ordered: #192 (viewport facade) is complete; #194 (static
viewport results), #196 (public API audit), and #155 (WebGPU-only required CI)
are the remaining core/infrastructure prerequisites. #199 is the umbrella gate,
not permission to implement breadth work. New work must answer the decision-gate
questions in the repository's issue template and carry `ready-for-supervisor`;
issues carrying `deferred` or `scope:deferred` are excluded from automatic
Supervisor intake.

### Breadth reactivation gate

Deferred capabilities may be reconsidered only after a deliberate product
review confirms all of the following:

- the canonical static viewport/results path is complete and documented;
- the public API audit has removed accidental implementation commitments;
- required WebGPU-only CI checks and local reproduction are understood; and
- a new issue records user value, minimum behavior, deletion candidates,
  non-goals, and why an existing abstraction cannot cover the work.

Completing this gate does not automatically promote any deferred issue. Each
future capability needs its own decision and acceptance criteria.

- **Core now:** #95, #97, #118, #119, #125, #127, #139, #192, #194, #205,
  #206, and #208.
- **Deferred:** #101 and #105 (advanced playback); #107 and #115 (streaming and
  LOD); #111 and #112 (Gmsh IO breadth).
- **Removal:** #100 and #132 are closed because their CPU fallback and CPU
  picking premises were removed in #171. #113 is closed because its former
  playback e2e path no longer exists.
- **Project infrastructure:** #155, #168, #196, #197, #199, #207, and #209.

The core classification of #119 is limited to the deterministic runtime
culling bug; it does not reactivate streaming. The core classification of #127
is limited to listener ownership in the current WebGPU demo; it does not
restore renderer switching or CPU fallback.

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
      [[architecture/packed-runtime|Packed scene runtime]]).
- [x] Add dirty-subtree transform propagation so unchanged branches are not
      re-flattened or re-multiplied (see
      [[architecture/packed-runtime|Packed scene runtime]]).
- [x] Make visibility updates delta-based with bitsets or ranges; avoid copying
      whole maps and sets for each hide/show operation (see
      [[architecture/packed-runtime|Packed scene runtime]]).
- [x] Batch visible instances by part while preserving stable instance handles.
- [x] Add bounds-based frustum culling and measure its CPU/GPU trade-offs.

## P1 — WebGPU renderer

- [x] Implement device/context initialization and explicit resource lifecycle.
- [x] Define the instance-buffer layout for transforms, style state, visibility,
      and pick IDs.
- [x] Upload each part's geometry once and issue instanced draws grouped by part.
- [x] Add buffer subrange updates for transform and interaction deltas (see
      [[rendering/renderer-subrange-updates|Renderer subrange updates]]).
- [x] Add a pick render pass and asynchronous single-pixel readback.
- [x] Cache per-frame GPU resources: bind groups per batch, a resized depth
      texture, and a pooled pick readback (see
      [[rendering/webgpu-resource-reuse|WebGPU resource reuse]]).
- [x] Split the renderer into focused modules (pipelines, draw, pick readback)
      below the 300-line limit (see [[architecture/source-organization|Source organization]]).
- [x] Encode emissive into the GPU instance record so hover/highlight themes
      take effect on the WebGPU path (see
      [[rendering/renderer-subrange-updates|Renderer subrange updates]]).

## P2 — interaction API

- [x] Add centralized part-level and instance-level selection, highlight, hover,
      and visibility state.
- [x] Define precedence when part and instance styles overlap.
- [x] Expose a clean `pick(x, y)` API returning stable part/instance targets.

## P2 — modern development workflow

- [x] Add a deterministic procedural FE example dataset with nested assemblies,
      repeated parts, documented dimensions, and a checked-in fixture or generator
      (see [[data/fe-fixture|FE fixture]]).
- [x] Build a demo assembly viewer with orbit, pan, zoom, reset, and camera
      state exposed through a small testable API.
- [x] Support orthographic and perspective projections with explicit camera
      tests for projection, clipping, and resize behavior.
- [x] Add Playwright tests for initial
      rendering, projection changes, pointer controls, reset, and the WebGPU
      product contract on the default e2e lane.
- [x] Add benchmarks for hierarchy compilation, updates, draw batching, and
      picking at representative model sizes (see [[engineering/benchmarks|Benchmarks]]).
- [x] Add performance budgets and regression checks to CI (see
      [[engineering/benchmarks|Benchmarks]]).
- [x] Align the supported Node version across `package.json`, CI, and docs.
- [x] Add WebGPU-capable browser coverage to the demo/e2e strategy as the
      default lane, with an explicit unsupported state for environments without
      WebGPU (see [[rendering/webgpu-e2e|WebGPU browser e2e lane]]). The CPU
      fallback was removed in #171.

## P2 — element topology

- [x] Add a typed finite-element model with Core linear shapes and retained
      deferred Tet10/Hex20 coverage, canonical VTK node ordering, and
      connectivity validation (see [[data/elements-topology|Element topology]]).
- [x] Extract oriented polygon faces (with quadratic mid-edge nodes) and unique
      element edges, with canonical-key deduplication and boundary/interior
      face classification (see [[data/elements-topology|Element topology]]).
- [x] Render linear elements (points, lines, and element edges) as
      triangle/line/point primitives, with boundary-face and edge-dedup
      culling and a mode-toggle demo (see
      [[rendering/element-rendering|Element rendering]]). Quadratic mid-edge
      tessellation is **Deferred** (see
      [[requirements/product-scope|product scope]]).

## P2 — engineering results

- [x] Add typed nodal/elemental scalar, vector, and symmetric tensor fields
      with stable ids, units, and `NaN` missing-value conventions (see
      [[data/results|Results]]).
- [x] Add derived quantities: magnitude, tensor magnitude, von Mises, and
      principal values, plus per-entity field helpers and derived scalar
      fields.
- [x] Add finite-value ranges that ignore missing data.
- [x] Add scalar color mapping with ranges, gradient stops, thresholds
      (discrete bands), clipping, and missing-value colors.
- [x] Add deformed-shape geometry from a nodal displacement field with a
      configurable scale.
- [x] ~~Add a dedicated load-case playback API (`CasePlayer`)~~ — **removed**
      as out of product scope (see [[data/results|Results]]).
- [x] GPU-side deformed rendering (per-instance vertex displacement) via
      `setDeformation` + `nodalDisplacements` (see [[data/results|Results]]).

## Improvement work items

- [x] Render pick ids into a universally reliable format (`rgba8unorm` with the
      id packed across the RGBA channels) instead of `r32uint`, whose SwiftShader
      readback proved unreliable; see [[rendering/pick-format|Pick texture format]].

## P3 — engineering verification (issue #60)

- [x] Add golden topology/connectivity fixtures for the standard element
      conventions, documenting node ordering and reference geometry in meters
      (`test/elements/golden.ts` + `golden.test.ts`; see
      [[data/elements-topology|Element topology]]).
- [x] Add numerical checks for bounds, transforms, mid-edge interpolation,
      face/edge extraction, and reference-element volume.
- [x] Add a large-model correctness stress test with explicit model sizes and
      structural budgets (`test/runtime/stress.test.ts`; see
      [[engineering/benchmarks|Benchmarks]]).
- [x] Add e2e visual regression for solid, edge, and selection modes on the
      WebGPU renderer (`e2e/visual.spec.ts`); the element render
      modes (solid/surface/edges/lines/points) are covered by the element-mode
      e2e tests in `e2e/demo.spec.ts`. The CPU renderer was removed in #171.
- [x] Document the browser/GPU capability matrix in the wiki
      ([[engineering/compatibility-matrix|WebGPU compatibility notes]]).
      **Deferred** — under the WebGPU-only contract the matrix collapses to
      "modern WebGPU browser or typed unsupported".
- [x] Deterministic import/export round trips and invalid-input diagnostics are
      covered by `test/io/roundtrip.test.ts` and `test/io/validate.test.ts`.

## P3 — large-model streaming

**Removed** — `src/streaming/` was deleted to match
[[requirements/product-scope|product scope]]. Do not re-add chunked loading,
spatial partitioning, LOD streams, or coordinate rebasing without an explicit
product decision.

Related: [[engineering/performance-issues|Performance issues and risks]],
[[architecture/instancing-strategy|Instancing strategy]], and
[[rendering/interactive-state|Interactive state]].
