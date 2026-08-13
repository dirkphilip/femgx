# Benchmarks and performance budgets

Deterministic performance validation for the CPU-side scene pipeline. See
[[engineering/quality-gate|Quality gate]] for how budgets fit into CI and
[[engineering/performance-issues|Performance issues]] for known renderer/GPU gaps.
FE demo and benchmark topology follows [[requirements/demo-fixtures|the demo
fixture requirements contract]].

## Budget gate (runs in default CI)

`npm run bench:budget` runs `test/bench/budget.test.ts` and fails if any
measured workload exceeds its documented ceiling. It is a dedicated CI step in
`.github/workflows/ci.yml` and is deliberately **not** part of
`npm run test:coverage`: v8 coverage instrumentation slows execution by
several multiples, so budgets are only meaningful on clean timing runs.

### Covered workloads

| Case                        | Model                            | Workload                                           |
| --------------------------- | -------------------------------- | -------------------------------------------------- |
| `createSceneRuntime`        | shallow 200 000 instances        | packed compile                                     |
| `createSceneRuntime` (deep) | balanced tree, 204 800 instances | nested transform composition                       |
| `setPartVisible` toggle     | part with 1 000 instances        | hide then show                                     |
| `setAssemblyVisible` toggle | subcase with 2 000 instances     | hide then show                                     |
| `setInstanceVisible` toggle | single instance                  | override, hide then show                           |
| `getDrawList`               | 200 000 visible                  | rebuild draw list                                  |
| `resolvePick`               | 50 000 lookups on 200 000        | O(1) index resolution                              |
| `heterogeneousElementParts` | 600 mixed linear elements        | grouped triangle/line/point tessellation           |
| `expand line geometry`      | 10,000 authored line segments    | one reusable four-corner triangle quad per segment |
| `createPart`                | 16 384 quads / 256 bodies        | element/body/face validation                       |
| `heterogeneousElementParts` | 16 384 FE quads / 256 bodies     | body-aware canonical tessellation                  |
| primitive topology ids      | 16 384 quads / 256 bodies        | face/body/element GPU-id preparation               |
| body-aware mesh edges       | 16 384 quads / 256 bodies        | edge topology and ownership preparation            |

### Stable model sizes and warmup rules

- Models are generated deterministically in `test/bench/fixtures.ts` with the
  sizes above; the scenes are constructed directly (not via `SceneBuilder`,
  whose immutable copies are intentionally quadratic for authoring convenience).
- `test/bench/measure.ts` defines the timing rules: **2 untimed warmup runs**,
  **7 timed samples**, **median** reported in milliseconds per iteration.
- Mutating workloads (visibility updates) are written as toggles that
  restore state, so every sample does the same amount of work instead of
  short-circuiting on a second no-op call.
- The body-heavy CPU fixture uses complete element, oriented-face, node, and
  body membership metadata. It guards the cold renderer-preparation path that
  previously performed repeated element/face scans and became quadratic as the
  element count grew.

### Interpreting budgets

Budgets are wall-clock ceilings calibrated at roughly **10x the measured
median** on a developer laptop, so they absorb CI noise and only trip on
order-of-magnitude or asymptotic regressions (for example a visibility update
that starts scanning all 200 000 instances, or a flattening loop that becomes
quadratic). They are not a micro-benchmark signal.

To recalibrate (e.g. when model sizes change, or after a large optimization):

```sh
PERF_REPORT=1 npx vitest run --config vitest.budget.config.ts --reporter=verbose
```

The printed medians are the reference numbers; update `budgetMs` in
`test/bench/budget.test.ts` to ~10x them and keep the old regression in the
commit message.

When a budget identifies unexplained scaling, capture a V8 CPU profile of only
that case before changing the algorithm:

```sh
mkdir -p /tmp/femgx-profile
node --cpu-prof --cpu-prof-dir=/tmp/femgx-profile \
  node_modules/vitest/vitest.mjs run --config vitest.budget.config.ts \
  --pool=threads --maxWorkers=1 -t "case name"
```

Vitest emits a runner profile and a worker profile; the worker profile contains
the measured workload. Open the latter in Chrome DevTools' Performance panel.

## Benchmark suite (opt-in, trend tracking)

`npm run bench` runs the Vitest `bench` suite in `test/bench/cpu.bench.ts` over
the same models plus a few extra update cases, including the large FE/body
validation, tessellation, topology-id, and edge-preparation stages. It reports
ops/sec / time per case for human review and trend comparison and is **not**
part of the default gate. The opt-in `.github/workflows/perf.yml`
(`workflow_dispatch`) runs the CPU suite on GitHub-hosted infrastructure. It
does not claim real-WebGPU measurements.

`test/bench/body-batch.bench.ts` compares 64 body visibility mutations issued
individually with the same ordered mutations inside `FemViewport.batch`. The
reference local run was 22.33x faster for the batch path; the result is a trend
signal rather than a cross-machine budget because it includes fake-GPU command
encoding.

## Large-model correctness stress test

`test/runtime/stress.test.ts` complements the timing budgets with a pure
correctness check at scale: 80 subcases x 2 000 placements (160 000 instances).
It verifies deterministic packed placement order, unique stable instance ids, the
part distribution implied by the placement cycle, compiled scene consistency,
runtime-derived instance identities, and pick round-trips. Budgets here are structural (explicit
model sizes and invariants) rather than wall clock, so the test runs in the
default unit suite without coverage-distorted timing.

## Browser performance (opt-in)

`npm run bench:webgpu` runs `e2e/perf.spec.ts` in system Chrome. It is skipped
by the normal e2e gate and has no device-dependent pass/fail timing threshold.
The benchmark fixes the canvas at 800×600 device pixels and DPR 1, requests a
high-performance WebGPU adapter, records one cold sample, performs two untimed
steady-state warmups, and reports p50 and p95 from seven timed steady-state
samples. Set `RUN_PERF_LARGE=1` to include the bounded
2-million-unique-triangle local case in addition to the default cases. The
point and node glyph settings are uniform-only presentation inputs (8 and 6 CSS
pixels by default); changing them does not add geometry, buffers, draw calls, or
render passes. Browser screenshot validation remains the authority for their
physical raster diameter across DPR and resize changes.
default matrix is bounded but covers separate geometry, part/batch,
placement/instance, and body-interaction dimensions; the local-only case is
kept out of normal runs:

| Case                    | Dimension                    | FE family | Unique elements | Submitted element occurrences | Instances | Unique triangles | Submitted triangles |
| ----------------------- | ---------------------------- | --------- | --------------: | ----------------------------- | --------: | ---------------: | ------------------: |
| `instanced-2.10m`       | reusable geometry            | Quad      |          16,384 | 1,048,576                     |        64 |           32,768 |           2,097,152 |
| `unique-250k`           | unique geometry              | Triangle  |         250,632 | 250,632                       |         1 |          250,632 |             250,632 |
| `unique-1m`             | unique geometry              | Triangle  |         999,698 | 999,698                       |         1 |          999,698 |             999,698 |
| `many-parts-100`        | distinct parts               | Triangle  |       1,008,200 | 1,008,200                     |       100 |        1,008,200 |           1,008,200 |
| `many-parts-1000`       | distinct parts               | Triangle  |         968,000 | 968,000                       |     1,000 |          968,000 |             968,000 |
| `placements-10k`        | placements/instances         | Quad      |              64 | 640,000                       |    10,000 |              128 |           1,280,000 |
| `bodies-256`            | body interaction             | Quad      |           1,024 | 1,024                         |         1 |            2,048 |               2,048 |
| `fe-quad-shell-visual`  | structured surface shell     | Quad      |             576 | 576                           |         1 |            1,152 |               1,152 |
| `fe-quad8-shell-visual` | structured surface shell     | Quad8     |             256 | 256                           |         1 |            1,536 |               1,536 |
| `fe-hex8-solid-visual`  | structured volume solid      | Hex8      |             512 | 512                           |         1 |              768 |                 768 |
| `fe-hex20-solid-visual` | structured volume solid      | Hex20     |             216 | 216                           |         1 |            1,296 |               1,296 |
| `unique-2m-local`       | unique geometry (local-only) | Triangle  |       2,000,000 | 2,000,000                     |         1 |        2,000,000 |           2,000,000 |

The planar-grid generator is shared by the visual performance fixture and the
benchmark case factory, so their geometry/count conventions cannot drift. Each
case creates one renderer over the same deterministic scene, drains
`GPUQueue.onSubmittedWorkDone()` for a cold upload/first frame, then reuses that
renderer through warmup and timed steady-state samples. The upload/attachment
estimate is the cold first-frame and visible-frame difference. After priming
reusable pick targets and applying a camera-reference invalidation, it measures
the combined lazy pick snapshot plus readback and then a cached-snapshot
readback; the pick-snapshot estimate is their difference. The report retains
both directly measured totals alongside the estimates. Portable WebGPU
timestamp queries are not required.

The structured FE cases use the validated `createElement` and
`heterogeneousElementParts` path with shared corner and mid-edge node ids. The
report adds `structuredFamily`, `uniqueElementCount`,
`submittedElementOccurrences`, `nodeCount`, and `faceCount`, alongside
`modelBuildMs` and `runtimeCompileMs`, so FE construction/tessellation and
runtime compilation remain separate from first-upload and steady visible-frame
GPU timings. Quad and Quad8 shells retain every surface face; Hex8 and Hex20
solids cull interior faces before tessellation. The 12×12×12 Hex20 capacity
tier is local-only under `RUN_PERF_LARGE=1`.
In this matrix, **unique elements** means authored logical element records,
while **submitted element occurrences** means the number of element occurrences
represented by the submitted visible topology; it must not be replaced with
one aggregate record for a grid or body. The matrix deliberately keeps unique
triangles and submitted triangles as separate columns because instancing
changes the latter only.

Triangle/Tri6 and Tet4/Tet10 belong to the same contract even when they are not
in the bounded default matrix: Triangle families represent authored surface
elements, and Tet families represent authored volume elements whose intended
faces are exposed. Quadratic variants retain their authored mid-edge node ids.
The fixture must report the family and logical-element count whenever those
values are relevant; a generic triangle count alone is insufficient evidence.

The JSON report identifies the browser user agent, adapter identity and fallback
status, enabled features, resolution, DPR, FE family, unique/submitted element
counts, triangle counts, timings, and an estimated renderer-owned
buffer/render-target memory breakdown. The breakdown includes appended inactive
result-color tails, expanded main/edge geometry, topology/pick metadata,
face-subset buffers, per-part deformation and highlight storage, six
instance-order buffers, pooled pick readback, and the multisampled visible color
targets. It separately reports retained GPU buffers, measurable CPU scene typed
arrays, and an upload-staging upper bound; `memoryEstimateScope` documents that
the renderer estimate excludes driver allocations. Edge/topology categories
remain explicit upper bounds where exact deduplication is performed during the
renderer upload.

Each WebGPU case also records an internal structural cost snapshot from its
final timed iteration. The snapshot is not a public renderer API and separates
render-pass counts, draw calls/index/instance totals, dynamic write calls/bytes,
CPU instance/order work, and physical visible-target dimensions and estimated
bytes. The counters explain timing trends; they are not a replacement for
queue-drained timings or driver memory reporting. A steady camera-only
iteration should have draw and uniform work but no instance/order upload or CPU
scan.

The structural matrix is read as orthogonal scenario dimensions rather than a
single score:

| Dimension       | Required cases or toggle                                                        |
| --------------- | ------------------------------------------------------------------------------- |
| geometry/CPU    | instancing-heavy, unique geometry, many parts                                   |
| pass features   | opaque, transparent, selected-visible/hidden, edges, nodes, origin triad, pivot |
| display density | DPR 1 baseline and a high-DPR physical-target estimate                          |

Feature toggles keep the same scene and camera where possible. Compare draw and
write deltas between the baseline and one toggle at a time so a pass or upload
regression remains attributable. The fixed 800×600 DPR-1 cases are the
reproducible trend baseline; high-DPR target accounting is a structural check,
not a normal capacity run.

Dynamic instance and emphasis uploads use their fixed 96-byte and 48-byte GPU
records as the diffing unit. Changed record indices are sorted and joined when
separated by at most two unchanged records, so adjacent and dense edits reduce
queue calls while distant sparse edits never create a first-to-last staging
span. The structural cost snapshot reports both calls and bytes: the extra
unchanged records in a joined range are intentional, and whole-buffer uploads
for capacity growth or device recovery remain separate paths.

The opt-in Playwright lane runs one case per test/context/device, gives each case
an explicit bounded timeout, writes one `webgpu-benchmark.json` artifact as soon
as its report returns, and aggregates only completed artifacts afterward. A
later capacity failure therefore preserves earlier evidence and names its
case/phase; a timeout is isolated to the titled case and its context is closed.
Compare reports only between similar browser/adapter configurations; the
numbers are a capacity envelope, not a universal triangle limit. GitHub-hosted
Actions does not run this browser benchmark until an explicitly owned real-GPU
runner exists.

Three representative cases (`instanced-2.10m`, `unique-1m`, and
`many-parts-100`) also include bounded interactive samples under
`case.interactive`. Each case reports a fixed-camera sample and a deterministic
moving-camera sample, with a 500 ms untimed warmup followed by a 2 second RAF
sample. The sample contains duration, frame count, FPS, p50/p95/maximum frame
intervals, and counts and percentages of intervals over 16.7 ms and 33.3 ms;
the final camera snapshot makes the moving-camera path observable. These are
refresh-rate and browser-loop measurements, not queue-drained GPU timings, and
the opt-in benchmark intentionally applies no FPS pass/fail threshold. The
existing queue-drained fields remain the source of capacity measurements.

The realistic-topology migration is tracked in [issue #526](https://github.com/dirkphilip/femgx/issues/526). Until it is complete, any
legacy large non-FE case that still uses aggregate metadata is a known
non-conforming migration gap and must not be described as representative FE
evidence. Realistic topology makes model build, tessellation, runtime
compilation, retained metadata, upload, rendering, and picking costs visible;
those costs are part of the performance question rather than overhead to hide.

## Interactive WebGPU inspection case

The full-screen demo exposes only the measured-safe FE inspection tiers through
the normal model selector. `demo/benchmark/model.ts` and the shared
`demo/fixture/planar-grid.ts` generator define the same deterministic cases for
the selector and the opt-in benchmark. Ordinary selector entries are lazy items:
startup creates no benchmark geometry, and selecting one yields to the browser
before building through the normal `Scene` → runtime → `FemViewport` path. The
capacity tiers remain available through the explicit local `?performanceLab=1`
opt-in, which exposes the full matrix including local-only cases. The existing
`Performance · 2.10M triangles` preset remains the small eagerly registered
showcase; its diagnostics distinguish the 32,768 unique triangles from
2,097,152 submitted triangles. The selector entries are for visual inspection;
the opt-in benchmark above owns reproducible cost breakdowns. The selector and
benchmark are subject to [[requirements/demo-fixtures|the same fixture
contract]]; issue #526 remains the work tracker until the migration is complete,
after which the linked requirement is the durable source of truth.

The toolbar's **Continuous** control is a separate, explicit inspection aid and
is off by default. While enabled, the demo chains one `FemViewport.invalidate()`
after each completed frame and reports a bounded rolling sample (warmup state,
duration, frame count, average FPS, p50/p95 interval, and longest interval) in
the existing diagnostics HUD. These are refresh-rate-limited RAF/render-loop
statistics, not queue-drained GPU timings. Disabling the control returns the
demo to true render-on-demand idle behavior; `npm run bench:webgpu` remains the
owner of queue-drained capacity measurements.

[engineering/performance-issues|Performance issues]: performance-issues.md
[engineering/quality-gate|Quality gate]: quality-gate.md
