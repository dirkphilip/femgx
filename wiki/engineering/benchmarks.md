# Benchmarks and performance budgets

Deterministic performance validation for the CPU-side scene pipeline. See
[[engineering/quality-gate|Quality gate]] for how budgets fit into CI.
GPU timing, mode, and memory rules live in
[[engineering/gpu-performance|GPU rendering performance]].
Local interaction targets and machine-fingerprinted operation reports live in
[[engineering/performance-baselines|Performance baselines]]. The default
buttonless mouse/pen hover binding also has an absolute scheduling target of no
more than one submitted hover query per animation frame, one hover query in
flight, and one newest queued hover query; touch hover remains immediate, and
this CPU report does not claim that GPU/readback behavior.
FE demo and benchmark topology follows [[requirements/demo-fixtures|the demo
fixture requirements contract]].

The Performance Lab offers structured Tet4 presets at 24,576, 131,712, and
257,250 authored elements. Each preset builds dense typed-array topology and
tessellation in the existing worker, transfers ownership of those buffers, and
then reconstructs the canonical interactive `Part` on the main thread. The
structured builder uses authored node ids directly as vertex indices, shares
the node-position buffer with geometry, and uses packed numeric face identities
instead of allocating string keys. Grid sizes are bounded to 35 cells per axis.
The
presets retain authored element, face, edge, and body identities while drawing
only the exterior face subset. Their build telemetry separates generation,
topology, tessellation, transfer preparation, transfer, and main-thread
reconstruction so fast mesh generation is not confused with renderer attach or
frame performance. Main-thread reconstruction supplies packed semantic columns
directly to the canonical `Part`; its public `elements`, `faces`, and `edges`
arrays remain available as lazy views for compatibility, while upload, picking,
face-subset, visibility-skin, and semantic-index paths traverse the columns.

The Performance Lab keeps its visible benchmark catalog lazy and may retain at
most one authoritative CPU model. Retention is bounded by a demo-private 256
MiB hard cap based on deterministic typed-array and conservative 208-byte
planar or 3,072-byte structured-FE element-record estimates; the estimate
excludes renderer-owned GPU resources and is a retention-policy estimate, not a
measurement of JavaScript heap usage. A successful under-cap case is reused
after an ordinary-catalog round trip, selecting another case evicts the prior
reference, and over-cap cases rebuild when explicitly selected again. The
current outcome is available only in the development diagnostics HUD.

The over-budget `fe-tet4-solid-132k` case is generated through one lazily
created demo-owned module Worker. The Worker receives only the deterministic
benchmark spec and request id, builds a dense typed geometry/topology payload,
transfers its buffers, and is terminated before the main thread reconstructs
the validated immutable `Part` and `Scene`. Face neighbors and the exterior
skin are transferred as compact typed arrays; the packed `Part` retains those
columns as the one authoritative semantic representation. A new selection,
catalog switch, file open, or controller destroy terminates the active Worker,
and the session commits only the current request id. Smaller cases retain the
simpler synchronous deferred path.

The Worker path records generation, topology, tessellation, transfer
preparation, transfer, reconstruction, transferred bytes, and final retained
typed bytes in development diagnostics. Dense cases also record deterministic
semantic allocation counts: element and primitive-range descriptors, face
descriptors and node/key references, edge descriptors and incidence
references, body membership references, and semantic-index map entries plus
exact node-to-face CSR bytes. These counts make the object-heavy portion
visible without pretending that a portable byte count for JavaScript objects
exists. With packed reconstruction, the 28-cell payload contains 131,712
elements, 526,848 faces, 160,804 edges, 1,580,544 edge-face references,
8,857,424 transferred typed bytes (8.45 MiB), and 47,372,404 retained typed
bytes (45.18 MiB); the 35-cell payload contains 257,250 elements, 1,029,000
faces, 311,255 edges, 3,087,000 edge-face references, 17,269,296 transferred
typed bytes (16.47 MiB), and 92,437,480 retained typed bytes (88.16 MiB). The
retained semantic columns are intentional: they preserve full-volume face,
edge, neighbor, and body semantics without per-row JavaScript objects. The
element, face, edge, primitive-range, and semantic-index entry counts are zero
until a descriptor-consuming convenience or optional feature explicitly asks
for them; body descriptors and typed references remain reported. The edge
count includes the authored face and body diagonals introduced by the six-Tet
cube split. Both typed-byte fields exclude JavaScript object heap and driver
allocations; a browser or Node `usedJSHeapSize` value is neither portable nor
authoritative. The existing opt-in system-Chrome benchmark remains the authority
for runtime compilation and first-upload measurements.

## Budget gate (runs in default CI)

`npm run bench:budget` runs `test/bench/budget.test.ts` and fails if any
measured workload exceeds its documented ceiling. It is a dedicated CI step in
`.github/workflows/ci.yml` and is deliberately **not** part of
`npm run test:coverage`: v8 coverage instrumentation slows execution by
several multiples, so budgets are only meaningful on clean timing runs.

### Covered workloads

| Case                              | Model                                  | Workload                                                          |
| --------------------------------- | -------------------------------------- | ----------------------------------------------------------------- |
| public runtime rebuild scaling    | 50k / 100k / 200k placements           | exported `createSceneRuntime`                                     |
| public scene replacement scaling  | 1 024 / 4 096 / 16 384 placements      | exported `Viewport.setScene`                                      |
| `createSceneRuntime` (deep)       | balanced tree, 204 800 instances       | nested transform composition                                      |
| structured Hex8 part scaling      | 512 / 1 728 / 4 096 elements           | exported `elementPart`                                            |
| `createElementModelFromFemModel`  | 250 000 Triangle3 elements             | typed connectivity conversion                                     |
| `createPart` (face subset)        | 20 000 declared/selected faces         | linear face identity validation                                   |
| `buildFaceSubsetIndices`          | 20 000 declared/selected faces         | declared-order compact index construction                         |
| `displayedPartBounds` (subset)    | 20 000 selected triangles              | indexed face visibility and bounds                                |
| `setPartVisible` toggle           | part with 1 000 instances              | hide then show                                                    |
| `setAssemblyVisible` toggle       | subcase with 2 000 instances           | hide then show                                                    |
| `setInstanceVisible` toggle       | single instance                        | override, hide then show                                          |
| host surface variant update       | 1 024 / 4 096 / 16 384 placements      | `Viewport.updateScene` with one stable occurrence rebound         |
| resident visibility skin update   | 1 / 2 / 4 / 8 elements and occurrences | one hidden element, shared signature, and exterior-subset restore |
| `getDrawList`                     | 200 000 visible                        | rebuild draw list                                                 |
| `sceneWorldBounds`                | 32 768 triangles × 64 placements       | reusable-part bounds and world transforms                         |
| `resolvePick`                     | 50 000 lookups on 200 000              | O(1) index resolution                                             |
| many-part scene scaling           | 1 024 / 2 048 / 4 096 parts            | register, place, snapshot, and compile                            |
| `setTargetsSelected`              | 16 384 element targets                 | one duplicate-safe immutable bulk transition                      |
| `setTargetsHighlighted`           | 8 192 element targets                  | one duplicate-safe immutable bulk transition                      |
| `setTargetsSelected` duplicate    | 16 384 + 1 024 repeated targets        | duplicate-safe bulk transition                                    |
| element interaction scaling       | 1 024 / 4 096 / 16 384 targets         | select, enumerate, and clear                                      |
| pick-region resolution scaling    | 16 384 / 100 000 element ids           | indexed identity resolution                                       |
| `immutable part ownership lookup` | 16 384 element ids                     | cached element-to-body metadata map reads                         |
| `collectEmphasisUpdates`          | 16 384 selected elements               | cached ownership and one reusable sync snapshot                   |
| `buildHighlightTable`             | 16 384 emphasis records                | bounded four-entry hash buckets                                   |
| `encodeEmphasisRecord` mirror     | 16 384 emphasis records                | CPU highlight-buffer preparation                                  |
| `elementPart`                     | 600 mixed linear elements              | grouped triangle/line/point tessellation                          |
| `elementPart` (large node pool)   | 500 000 nodes / one Tet4               | volume tessellation without a transient node copy                 |
| `expand line geometry`            | 10,000 authored line segments          | one reusable four-corner triangle quad per segment                |
| `createPart`                      | 16 384 quads / 256 bodies              | element/body/face validation                                      |
| `elementPart`                     | 16 384 FE quads / 256 bodies           | body-aware canonical tessellation                                 |
| primitive topology ids            | 16 384 quads / 256 bodies              | face/body/element GPU-id preparation                              |
| body-aware mesh edges             | 16 384 quads / 256 bodies              | edge topology and ownership preparation                           |

### Stable model sizes and warmup rules

- Models are generated deterministically in `test/bench/fixtures.ts` and
  `demo/benchmark/structured-fe.ts` with the sizes above. Runtime fixtures are
  constructed outside timed regions. Fixture generation supplies inputs and
  structural counts but is not performance evidence; scaling series time the
  exported core operations `elementPart`, `createScene`, and
  `createSceneRuntime`.
- `test/bench/measure.ts` defines the timing rules: **2 untimed warmup runs**,
  **7 timed samples**, **median** reported in milliseconds per iteration.
  Scaling series use one warmup and three samples to keep the default gate
  bounded.
- Scaling cases compare milliseconds per declared unit across their fixed
  sizes and permit at most a 3x normalized-cost spread. This catches quadratic
  growth without encoding one developer machine's absolute speed.
- Mutating workloads (visibility updates) are written as toggles that
  restore state, so every sample does the same amount of work instead of
  short-circuiting on a second no-op call.
- The body-heavy CPU fixture uses complete element, oriented-face, node, and
  body membership metadata. It guards the cold renderer-preparation path that
  previously performed repeated element/face scans and became quadratic as the
  element count grew.

Host-updated surface revisions are measured separately from cold scene
construction. The renderer attachment cost records changed instance scans,
instance/order writes, retained buffer identity, and released source storage;
the variant-update regression keeps one stable placement rebound while the
remaining placements and a shared destination variant stay unchanged. This
distinction prevents a full next-runtime compile from being mistaken for
geometry upload or unrelated GPU storage work.

Fully resident visibility evidence is separate from host replacement evidence.
The focused renderer regression compares one hidden element against its
exterior subset: submitted surface and pick indices remain the compact visible
skin count, while an unaffected repeated occurrence keeps the exterior subset.
Repeated occurrences with the same sparse body/element signature reuse one
GPU index buffer. Restoring visibility releases inactive skin storage. The
bounded cache retains at most two full-order equivalents per part (64 KiB
minimum, 16 MiB maximum); budget overflow is reported by the correct complete
topology fallback rather than a guessed surface.

### Interpreting budgets

Budgets are wall-clock ceilings calibrated at roughly **10x the measured
median** on a developer laptop, so they absorb CI noise and only trip on
order-of-magnitude or asymptotic regressions (for example a visibility update
that starts scanning all 200 000 instances, or a flattening loop that becomes
quadratic). They are not a micro-benchmark signal.

To recalibrate (e.g. when model sizes change, or after a large optimization):

```sh
PERF_REPORT=1 npx vitest run --config config/vitest.budget.config.ts --reporter=verbose
```

The printed medians are the reference numbers; update `budgetMs` in
`test/bench/budget.test.ts` to ~10x them and keep the old regression in the
commit message.

## Large CPU scaling (local opt-in)

`npm run bench:scaling:large` runs exported `elementPart` at 13 824, 42 875,
and 103 823 authored Hex8 elements. Mesh generation happens before the timed
region. The command is excluded from `npm test`, coverage, the default budget
gate, and CI. The local runner uses three samples without a separate warmup and
a bounded 60-second per-test timeout; a reference run takes about 20 seconds.

This case measures the canonical authored solid topology retained by
`elementPart`. It does not substitute authored element count with a surface
triangle aggregate and does not claim a boundary-only submitted triangle
count. Its pass/fail contract is the same maximum 3x spread in normalized cost,
not an absolute duration.

When a budget identifies unexplained scaling, capture a V8 CPU profile of only
that case before changing the algorithm:

```sh
mkdir -p /tmp/femgx-profile
node --cpu-prof --cpu-prof-dir=/tmp/femgx-profile \
  node_modules/vitest/vitest.mjs run --config config/vitest.budget.config.ts \
  --pool=threads --maxWorkers=1 -t "case name"
```

Vitest emits a runner profile and a worker profile; the worker profile contains
the measured workload. Open the latter in Chrome DevTools' Performance panel.

## Performance report (opt-in, trend tracking)

`npm run bench:operations` runs the local CPU operation matrix for half/all
131,712-element selection and clear, hover diffs over unchanged dense selection,
sparse element visibility and restore, 256-body recolor and clear, elemental
result snapshot builds for 1/8/64 placements, one CPU hover/identity transition
on one active-result fixture, a high-water sparse-highlight one-record hover
after 131,712 active records, direct near-last-element inspection and a
controller-like deepest triangle pick on the 131,712-element Tet4 fixture, and
200,000-placement scene/runtime operations. Pick setup, subset/index expansion,
and renderer-side 1-based ID preparation happen before timing; the deepest row
validates the returned node and element identity and resolves adjacency. The
6,419,736-byte figure covers only the two retained node-to-triangle-face CSR
typed arrays for this fixture; Maps and object overhead are excluded. One
observed cold, unsampled `PartSemanticIndex` construction for this distinct
`Part` identity took 250.930250 ms. Attachment eagerly pays that construction
for each distinct or replacement `Part` identity; it is not part of per-pick
timings.
It emits one fingerprinted JSON report. Set `PERF_BASELINE_FILE` to write it to
an explicit path; otherwise the report is printed only. Its CPU/fake-GPU
highlight case measures renderer CPU table encoding/diff plus fake queue writes;
it does not measure real GPU submission, upload completion, draw, or
first/steady-frame behavior. Those claims remain in the opt-in WebGPU report. The targets and
changelog format are defined in
[[engineering/performance-baselines|Performance baselines]].

The opt-in `npm run bench:selection-sync` lane records the 131,712-element Tet4
selection seam with stable CPU boundaries: fresh interaction identity through
`collectDenseElementSelections` and packed highlight payload writing, separate
draw-range construction, and one unchanged identity-cache repeat. It records
the authored 526,848-face descriptor count, exterior 9,408-face subset, dense
4,116-word/16,468-byte payload, exact neighbor-face entries traversed, and the
retained neighbor-CSR bytes. Timed draw samples assert the intentional half
range-cap fallback and the all-but-one/all draw-call shapes. Fixture creation,
semantic-index construction, and storage allocation remain outside timing. The
lane does not claim fake queue writes, GPU completion, or frame smoothness.
Method, targets, current numbers, and the before/after changelog live in
[[engineering/performance-baselines|Performance baselines]].

The opt-in `npm run bench:node-selection-sync` lane records 26 isolated CPU and
fake-GPU seams for the same Tet4 part: cold node-sprite expansion, cold dense
node-topology construction, immutable selection construction, profitable dense
membership classification, sparse emphasis collection, fresh highlight-storage
encoding/copy, selected-node order construction, and isolated node-order sync.
It covers two nodes, half and all 24,389 nodes in one occurrence, plus one node
across 32 occurrences. Fixture/model construction and semantic-index work are
outside timing. Each cold topology sample writes 526,848 element-node owner
occurrences into 9,112,460 bytes of raw typed output; each dense half/all
selection uses a 3,056-byte payload in 3,200 bytes of fresh highlight storage.
The rows are deliberately non-additive and do not claim real queue submission,
upload completion, draw, or frame time. Those boundaries are measured by the
schema-11 system-Chrome report's `nodeSelection` section.

The real-WebGPU node lane is opt-in and limited to `fe-tet4-solid-132k`. It
records half/all immutable-state and renderer-sync CPU time, queue-drained first
frame, seven steady frames, clear, structural node draw work, and highlight
storage bytes. A separate `RUN_PERF_NODE_VISUAL=1` Playwright lane reapplies all
nodes and captures nonblank real-WebGPU screenshots at desktop and 390×844.
The first half-node frame intentionally includes lazy node-overlay topology,
sprite-buffer, GPU-buffer, and bind-group preparation; the following all-node
phase is resident and must not be compared as another cold upload.

`PERF_REPORT=1 npm run bench:budget` runs the calibrated budget workloads and
prints their measured medians for human review and trend comparison. The
opt-in `.github/workflows/perf.yml` (`workflow_dispatch`) runs this same report
on GitHub-hosted infrastructure. The report does not claim real-WebGPU
measurements and is separate from the required default-CI budget gate.

`npm run bench` remains a local opt-in Vitest benchmark for the distinct body
visibility batching comparison in `test/bench/body-batch.bench.ts`. It reports
the relative cost of individual versus `Viewport.batch` updates and is not
part of the default gate.

`test/bench/body-batch.bench.ts` compares 64 body visibility mutations issued
individually with the same ordered mutations inside `Viewport.batch`. The
reference local run was 22.33x faster for the batch path; the result is a trend
signal rather than a cross-machine budget because it includes fake-GPU command
encoding.

## Large-model correctness stress test

`test/scene-runtime/stress.test.ts` complements the timing budgets with a pure
correctness check at scale: 80 subcases x 2 000 placements (160 000 instances).
It verifies deterministic packed placement order, unique stable instance ids, the
part distribution implied by the placement cycle, compiled scene consistency,
runtime-derived instance identities, and pick round-trips. Budgets here are structural (explicit
model sizes and invariants) rather than wall clock, so the test runs in the
default unit suite without coverage-distorted timing.

## Browser performance (opt-in)

### Element box-selection phases

The opt-in `webgpu-benchmark` report (schema version 12) adds
`selection.phases` for the reusable 64-placement case and the 250k/1m
unique-geometry cases. The explicit large run also includes the optional
2m-unique local case. Each `narrow`, `one-shell`, and `broad` phase validates a
non-empty element result and records invalid-snapshot timing, cached readback,
interaction-state mutation, interaction synchronization, first selected frame,
steady selected-frame p50/p95, clearing, selected occurrence count, renderer
cost counters, and selected element-record byte count. Authored one/half/all
phases additionally time target construction, so resolving selected occurrence
slots is not hidden outside the named orchestration boundary. The
`fe-tet4-solid-132k` case adds `all-but-one` and `all-authored` phases that
select 131,711 and 131,712 retained element identities directly; their raster
readback fields are zero because no box query is involved.
Dense element-only selection uses one selected-region skin: the validated exterior
subset plus authored faces whose selected owner borders an unselected neighbor.
Fragmented skins that exceed the bounded range-draw budget retain the full exact
fallback. The phases' target counts, dense-selection bytes, interaction timings,
clearing, and first selected-frame cost snapshots guard this path separately from
the 4,704-target raster-visible broad-box result. The selected-frame snapshot is captured after the
first selected render, so `selection-visible` and `selection-hidden` draw/index
counts expose x-ray amplification. Schema 12 captures `interactionGpuCost` after
the first selected render, rather than on the pre-selection synchronization
frame. The case-level
`estimatedMemory.highlightBytes` and
`estimatedMemory.pickReadbackBytes` retain the resident highlight table and
readback-pool estimates. The browser/adapter metadata and submitted/unique
triangle counts remain at the case/report level. A focused local reproduction
is:

```sh
RUN_PERF=1 E2E_BASE_URL=http://127.0.0.1:5173 \
  npx playwright test e2e/demo/perf.spec.ts --project=chrome \
  --grep "instanced-2.10m"
```

The benchmark records each case's scene/model construction once as
`modelBuildMs`, then records runtime compilation, renderer creation, attachment,
and frame work at separate boundaries. It uses the real system Chrome/WebGPU
lane for GPU and frame claims; the default lane is DPR 1 and the focused
`unique-250k` readback case runs at DPR 2. No-GPU CI is only a contract check.

Optional triangle-edge geometry is not part of the cold attachment estimate.
The benchmark memory estimator accepts the part ids whose presentation-edge
resources have materialized, so edge position, index, topology, and node-id
bytes are counted only after the first edge draw. This mirrors the retained
per-part cache: toggling additional placements does not multiply those bytes.
The estimate does not include node-presentation sidecars, interaction growth,
construction temporaries, JavaScript object heap, or driver allocations.

`npm run bench:webgpu` (alias `npm run test:e2e:performance`) runs
`e2e/demo/perf.spec.ts` in system Chrome. It is skipped
by the normal e2e gate and has no device-dependent pass/fail timing threshold.
The benchmark fixes the canvas at 800×600 device pixels and DPR 1, requests a
high-performance WebGPU adapter, records one cold sample, performs two untimed
steady-state warmups, and reports p50 and p95 from seven timed steady-state
samples. Set `RUN_PERF_LARGE=1` to include the bounded
2-million-unique-triangle local case in addition to the default cases. The
many-piece cases additionally time target construction, immutable interaction
state, stable-id-to-slot resolution, renderer synchronization, a queue-drained
first frame, seven queue-drained steady frames, and clear/restore. Their
selection, recolor, visibility, and scene-replacement rows cover one, half, and
all placements and assert exact instance-write and submitted-draw work;
replacement scene build includes owning validation while runtime compilation
and renderer application remain separate fields. The point and node glyph
settings are uniform-only presentation inputs (8 and 6 CSS
pixels by default); changing them does not add geometry, buffers, draw calls, or
render passes. Browser screenshot validation remains the authority for their
physical raster diameter across DPR and resize changes.
The default matrix is bounded but covers separate geometry, part/batch,
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
| `fe-hex8-solid-visual`  | structured volume solid      | Hex8      |             512 | 296                           |         1 |            6,144 |                 768 |
| `fe-tet4-solid-132k`    | structured volume solid      | Tet4      |         131,712 | 9,240                         |         1 |          526,848 |               9,408 |
| `fe-hex20-solid-visual` | structured volume solid      | Hex20     |             216 | 152                           |         1 |            7,776 |               1,296 |
| `unique-2m-local`       | unique geometry (local-only) | Triangle  |       2,000,000 | 2,000,000                     |         1 |        2,000,000 |           2,000,000 |

The two two-million-triangle cases answer different questions and must remain
separate. `instanced-2.10m` reuses 16,384 authored Quad elements (32,768 unique
triangles) across 64 placements to exercise common interactive instancing at
2,097,152 submitted triangles. `unique-2m-local` owns 2,000,000 distinct
Triangle elements, 1,002,001 nodes, and one placement; it exposes unique-ownership
scene construction, dense selection, and presentation-resource construction
that instancing deliberately amortizes.

### Schema-12 many-piece evidence

The clean system-Chrome reports
`perf-reports/30-local-many-parts-1000.json` and
`perf-reports/31-local-placements-10k.json` were recorded from implementation
SHA `ba7c04c31f506c358992cd974e03aca2bab23983` on Apple Metal 3 with Chrome
151, an 800×600 DPR-1 viewport, two untimed warmups, seven timed steady
samples, and a non-fallback WebGPU adapter. `many-parts-1000` owns 1,000
distinct Triangle parts and placements, 968,000 submitted triangles, and 1,000
draw calls. `placements-10k` reuses one 64-Quad part across 10,000 placements,
submitting 1,280,000 triangles in one instanced draw. These meanings must stay
separate: the first stresses distinct resources; the second stresses placement
and interaction scale while amortizing geometry.

Cold CPU fields time synchronous construction/encoding; queue fields wait for
submitted GPU work. Pick estimate excludes cached-map readback, while the next
field includes it. Steady values are queue-drained p50/p95 over seven samples.

| Case              | Model / runtime / renderer ms | Attach / first CPU / first queue ms | Steady CPU p50/p95 ms | Steady queue p50/p95 ms | Pick estimate / +readback / cached readback p50/p95 ms | Final opaque calls / indices / instances |
| ----------------- | ----------------------------: | ----------------------------------: | --------------------: | ----------------------: | -----------------------------------------------------: | ---------------------------------------: |
| Many parts 1,000  |            140.2 / 1.2 / 38.9 |               464.3 / 450.0 / 472.4 |             1.1 / 1.2 |               5.0 / 5.5 |                        11.9/13.2 · 12.2/13.5 · 0.3/0.4 |                1,000 / 2,904,000 / 1,000 |
| Placements 10,000 |              6.1 / 7.2 / 41.0 |                  25.3 / 14.3 / 29.1 |             0.1 / 0.2 |               2.3 / 2.5 |                        10.3/12.2 · 10.6/12.6 · 0.3/0.4 |                         1 / 384 / 10,000 |

Selection writes and clears exactly `targetCount × 96` instance bytes. The
reported selected draw tuple is calls/indices/instances for each of the
selected-visible and selected-hidden submissions.

| Case / selection | Targets | Target / state / slot / sync ms | First / steady p50/p95 / clear ms | Apply / clear bytes | Selected visible and hidden draw tuple |
| ---------------- | ------: | ------------------------------: | --------------------------------: | ------------------: | -------------------------------------: |
| Parts one        |       1 |           0.0 / 0.2 / 0.0 / 0.8 |               6.0 · 5.2/6.1 · 6.6 |             96 / 96 |                          1 / 2,904 / 1 |
| Parts half       |     500 |           0.0 / 0.1 / 0.0 / 3.6 |              13.3 · 8.7/8.9 · 9.2 |     48,000 / 48,000 |                  500 / 1,452,000 / 500 |
| Parts all        |   1,000 |           0.1 / 0.1 / 0.1 / 5.0 |           21.3 · 13.1/16.2 · 13.0 |     96,000 / 96,000 |              1,000 / 2,904,000 / 1,000 |
| Placements one   |       1 |           0.1 / 0.2 / 0.1 / 1.8 |               2.7 · 2.6/2.8 · 3.0 |             96 / 96 |                            1 / 384 / 1 |
| Placements half  |   5,000 |          0.2 / 0.6 / 0.5 / 10.9 |              3.8 · 3.1/3.9 · 10.5 |   480,000 / 480,000 |                        1 / 384 / 5,000 |
| Placements all   |  10,000 |          0.1 / 0.7 / 0.7 / 17.3 |              4.8 · 4.0/5.6 · 19.7 |   960,000 / 960,000 |                       1 / 384 / 10,000 |

Recolor uses the canonical public `setInstanceOverrides` immutable bulk
transition. Apply and clear again write exactly `targetCount × 96` bytes, and
the full opaque draw remains unchanged: 1,000/2,904,000/1,000 for distinct
parts and 1/384/10,000 for shared placements.

| Case / recolor  | Targets | Target / state / slot / sync ms | First / steady p50/p95 / clear ms | Apply / clear bytes |
| --------------- | ------: | ------------------------------: | --------------------------------: | ------------------: |
| Parts one       |       1 |           0.0 / 0.1 / 0.0 / 0.2 |               5.1 · 5.2/5.5 · 5.7 |             96 / 96 |
| Parts half      |     500 |           0.1 / 0.2 / 0.1 / 2.1 |               6.1 · 4.9/5.2 · 7.8 |     48,000 / 48,000 |
| Parts all       |   1,000 |           0.0 / 0.3 / 0.0 / 3.2 |               6.3 · 5.9/6.4 · 9.4 |     96,000 / 96,000 |
| Placements one  |       1 |           0.0 / 0.0 / 0.0 / 0.5 |               2.2 · 2.3/2.7 · 2.7 |             96 / 96 |
| Placements half |   5,000 |           0.2 / 1.2 / 0.7 / 8.0 |              2.7 · 2.2/2.8 · 13.2 |   480,000 / 480,000 |
| Placements all  |  10,000 |          0.1 / 1.2 / 0.8 / 18.3 |              2.8 · 2.3/2.7 · 15.6 |   960,000 / 960,000 |

Visibility independently predicts post-hide submitted indices from requested
slots, compares that prediction with renderer counters, and asserts exact
restoration. The draw tuple is opaque calls/indices/instances after hiding.

| Case / visibility | Targets | Mutation / sync ms | First / steady p50/p95 / restore ms | Remaining triangles | Indices hidden / restored | Opaque draw tuple after hide |
| ----------------- | ------: | -----------------: | ----------------------------------: | ------------------: | ------------------------: | ---------------------------: |
| Parts one         |       1 |          0.0 / 0.3 |                 5.1 · 5.2/5.9 · 6.3 |             967,032 |     2,901,096 / 2,904,000 |        999 / 2,901,096 / 999 |
| Parts half        |     500 |          0.3 / 1.5 |                 4.0 · 3.1/3.7 · 7.7 |             484,000 |     1,452,000 / 2,904,000 |        500 / 1,452,000 / 500 |
| Parts all         |   1,000 |          0.1 / 2.1 |                 2.7 · 0.8/1.2 · 8.2 |                   0 |             0 / 2,904,000 |                    0 / 0 / 0 |
| Placements one    |       1 |          0.2 / 2.7 |                 3.1 · 2.2/4.4 · 4.7 |           1,279,872 |     3,839,616 / 3,840,000 |              1 / 384 / 9,999 |
| Placements half   |   5,000 |          0.6 / 1.1 |                 2.2 · 1.6/1.9 · 4.1 |             640,000 |     1,920,000 / 3,840,000 |              1 / 384 / 5,000 |
| Placements all    |  10,000 |          1.1 / 0.7 |                 1.0 · 0.8/1.2 · 3.7 |                   0 |             0 / 3,840,000 |                    0 / 0 / 0 |

Replacement scene build below includes validation. Runtime compile, renderer
CPU encoding, and queue completion are separate. Apply and restore both report
exact changed-occurrence writes with positive write calls; the final opaque
draw tuple equals the original scene.

| Case / replacement | Changed | Build+validation / runtime ms | Renderer CPU / queue ms | Steady p50/p95 / restore ms | Apply / restore bytes |   Final opaque draw tuple |
| ------------------ | ------: | ----------------------------: | ----------------------: | --------------------------: | --------------------: | ------------------------: |
| Parts one          |       1 |                     0.7 / 0.9 |              4.5 / 10.3 |               6.6/8.3 · 8.4 |               96 / 96 | 1,000 / 2,904,000 / 1,000 |
| Parts half         |     500 |                     0.5 / 0.7 |               3.7 / 8.6 |               4.9/5.2 · 8.2 |       48,000 / 48,000 | 1,000 / 2,904,000 / 1,000 |
| Parts all          |   1,000 |                     0.4 / 0.5 |               4.1 / 9.2 |               5.3/9.0 · 8.9 |       96,000 / 96,000 | 1,000 / 2,904,000 / 1,000 |
| Placements one     |       1 |                     8.5 / 7.7 |              7.0 / 10.0 |               2.3/3.0 · 7.6 |               96 / 96 |          1 / 384 / 10,000 |
| Placements half    |   5,000 |                     3.8 / 4.9 |              8.7 / 11.6 |              2.2/2.7 · 11.6 |     480,000 / 480,000 |          1 / 384 / 10,000 |
| Placements all     |  10,000 |                     1.8 / 6.2 |             12.2 / 15.1 |              2.2/2.7 · 14.4 |     960,000 / 960,000 |          1 / 384 / 10,000 |

| Case              |   Geometry | Pick metadata |  Instance | Highlight / deformation / fixed / readback | Retained renderer total | CPU scene typed | Upload staging upper | Renderer peak upper | Render targets |
| ----------------- | ---------: | ------------: | --------: | -----------------------------------------: | ----------------------: | --------------: | -------------------: | ------------------: | -------------: |
| Many parts 1,000  | 46,464,000 |    46,480,000 |   100,000 |                      144 / 4 / 324 / 1,280 |              93,045,752 |      26,492,000 |           92,944,000 |         185,989,752 |     48,480,000 |
| Placements 10,000 |      6,144 |         6,160 | 1,000,000 |                      144 / 4 / 324 / 1,280 |               1,014,056 |         643,804 |               12,304 |           1,026,360 |     48,480,000 |

All memory values are bytes; edge-index and subset bytes are both zero in these
two cases. Retained estimates include renderer-owned geometry, pick metadata,
instance, highlight, deformation, fixed, and readback buffers only. Upload
staging and render targets are reported separately; node-presentation sidecars,
interaction growth, construction temporaries, JavaScript heap, and driver
allocations are excluded.

Before the bulk transition, same-session non-artifact observations put shared
10,000-placement half/all immutable recolor state at 427.3/1,823.9 ms. The clean
hardware rows are 1.2/1.2 ms (356.1×/1,519.9×), but the baseline has no durable
clean JSON and is not a clean-SHA comparison. A separate synthetic fake-GPU
attachment test improved at 1,024/4,096/16,384 placements from
1.113/4.274/19.276 ms to 0.667/2.497/10.481 ms (1.67×/1.71×/1.84×). This is a
CPU renderer seam, not hardware evidence. Public `Viewport.setScene` remained
about 47 ms at 16,384 placements before and after, with noisy variation because
runtime compilation and viewport reconciliation dominate that end-to-end path;
no `setScene` speedup is claimed.

### Schema-12 two-million local evidence

The current unique-geometry reference is the clean system-Chrome report
`perf-reports/29-local-two-million-triangle.json` from implementation SHA
`b7ab6b37ce878626e52736b957ea54df1a2567b6`. It was recorded on Apple Metal 3
with Chrome 151, an 800×600 DPR-1 four-sample viewport, two untimed warmups,
seven timed steady samples, and a non-fallback WebGPU adapter. Cold CPU fields
time synchronous construction/encoding; cold frame fields drain the GPU queue.
RAF intervals are a separate two-second browser-loop sample. GPU timestamp
values remain raw ticks because the adapter exposes no timestamp period.

| Surface phase                           | Exact clean result                                                                       |
| --------------------------------------- | ---------------------------------------------------------------------------------------- |
| Model / runtime / renderer construction | 585.8 / 0.1 / 39.7 ms                                                                    |
| Attachment and first frame              | 1,375.2 ms CPU; 1,424.5 ms queue-drained                                                 |
| Retained visible frame                  | 3.3 / 24.3 ms queue-drained p50/p95; 0.1 / 0.2 ms CPU                                    |
| Fixed / moving RAF                      | 120.0 / 119.5 FPS; 9.8 / 10.0 ms p95; no interval over 16.7 ms                           |
| Element hover                           | 14.3 ms pick; 0.0 ms state; 0.2 ms sync; 6.3 ms first; 6.3 / 7.9 ms steady; 3.1 ms clear |
| Hide all / restore                      | 0.0 ms mutation; 0.2 ms sync; 0.8 ms first; 0.8 / 0.8 ms steady; 3.1 ms restore          |

Visibility asserts the surface submission changes from 6,000,000 indices to
zero and returns to 6,000,000 after restore. Hover records the pick separately
from the post-pick immutable transition, writes one 144-byte emphasis record,
and asserts the highlighted element remains admitted; a fast no-op therefore
cannot satisfy the report.

| Authored selection |   Targets | Build / state / sync ms | First ms | Steady p50 / p95 ms | Dense / record bytes |
| ------------------ | --------: | ----------------------: | -------: | ------------------: | -------------------: |
| One                |         1 |         0.0 / 0.0 / 0.2 |      6.6 |           6.2 / 6.5 |               0 / 48 |
| Half               | 1,000,000 |      7.2 / 71.8 / 212.7 |     13.9 |         10.4 / 11.1 | 250,004 / 48,000,000 |
| All                | 2,000,000 |    11.8 / 162.9 / 313.5 |     19.1 |         10.6 / 14.4 | 250,004 / 96,000,000 |

All three phases use one selected occurrence, write the expected highlight
payload, clear in 3.0–3.4 ms, and assert exact selected-visible and
selected-hidden work: 3 indices for one target and 6,000,000 indices for
half/all. The separate narrow/shell/broad visible-region rows remain in the
JSON, including readback, state, sync, first/steady frame, and clear boundaries.

Nodes and derived presentation edges are lazy and are measured separately from
surface attachment. Cold node presentation took 519.9 ms CPU and 580.7 ms
queue-drained after 0.5 ms interaction sync, submitting 6,012,006 node indices.
Adding presentation edges then took 905.9 ms CPU and 1,003.8 ms queue-drained
after 0.3 ms sync, submitting 6,004,000 edge indices. With both overlays
resident, fixed/moving RAF measured 119.611/120.002 FPS and 9.71/9.80 ms p95,
with no interval over 16.7 ms. Overlay hover measured 26.2 ms pick, 0.5 ms sync,
0.5 ms first frame, and 0.5/1.0 ms steady p50/p95. The overlay all-element
selection measured 24.6 ms target construction, 221.2 ms state construction,
293.0 ms sync, and 1.7 ms first frame while retaining exact 6,000,000-index visible/hidden
selection work.

The schema-12 memory fields deliberately distinguish retained estimates from
construction allocations. With presentation edges materialized, the retained
renderer-buffer estimate is 768,001,868 bytes and its upload-staging upper
bound is 768,000,016 bytes; the 576,000,000-byte presentation-edge value is an
upper bound, not combined edge-plus-node memory. The dense edge builder records
252,663,296 exact construction bytes and 264,112,000 final typed bytes. At
least 416,112,000 typed bytes overlap during finalization; 516,775,296 bytes is
the no-intermediate-GC upper bound. Node-presentation sidecars, interaction
growth, JavaScript heap, driver allocations, and general build temporaries are
excluded from the retained estimate, while the exact dense-edge construction
fields report their narrower allocation boundary explicitly.

For comparison, the same-session pre-edit presentation-edge observation was
25,026.7 ms CPU and 25,150.9 ms queue-drained. It has no durable clean JSON
artifact and is not a clean-SHA report; it is retained only as the observed
baseline for the 27.63× CPU and 25.06× queue-drained improvement to the clean
schema-12 result.

### Prior full real-WebGPU matrix (2026-08-17)

The prior full-matrix report was run on merged `main` SHA `86f55e5` on
2026-08-17. It used system Chrome `151.0.7922.34` on an Apple `metal-3`
adapter with `isFallbackAdapter: false`, features
`core-features-and-limits` and `timestamp-query`, 2 untimed warmups, and 7
timed samples. The reference canvas was 800×600 at DPR 1; `unique-250k` was
the explicit high-DPR physical-target case at DPR 2. Queue-drained wall time
and synchronous encoding are milliseconds. The adapter exposed no timestamp
period, so GPU pass values remain raw timestamp ticks in opaque/transparency/
composite order and must not be compared with the millisecond columns.

| Case                         | CPU p95 ms | Queue p95 ms | GPU pass p95 ticks (O/T/C)        | RAF evidence                                 | Structure (admission min/top/feature; opaque draws×instances; writes) | Retained / peak MiB |
| ---------------------------- | ---------: | -----------: | --------------------------------- | -------------------------------------------- | --------------------------------------------------------------------- | ------------------: |
| `instanced-2.10m`            |        0.2 |          5.8 | 5,570,560 / 1,441,792 / 8,388,608 | moving 9.6 / 10.4 ms, 0 / 0 over 16.7 / 33.3 | 1 / 0 / 1; 1×64; 7                                                    |         12.5 / 25.0 |
| `unique-250k` (DPR 2)        |        0.2 |          2.8 | 3,997,696 / 1,638,400 / 1,310,720 | —                                            | 1 / 0 / 1; 1×1; 7                                                     |         24.9 / 49.7 |
| `unique-1m`                  |        0.3 |          6.1 | 5,898,240 / 2,424,832 / 2,490,368 | moving 9.8 / 10.3 ms, 0 / 0                  | 1 / 0 / 1; 1×1; 7                                                     |        99.2 / 198.3 |
| `many-parts-100`             |        0.4 |          2.5 | 4,259,840 / 1,048,576 / 1,114,112 | moving 9.3 / 10.4 ms, 0 / 0                  | 100 / 0 / 100; 100×100; 7                                             |       100.2 / 200.4 |
| `many-parts-1000`            |        1.4 |          6.9 | 4,325,376 / 720,896 / 720,896     | —                                            | 1,000 / 0 / 1,000; 1,000×1,000; 7                                     |        96.8 / 193.6 |
| `placements-10k`             |        0.2 |          4.5 | 3,145,728 / 655,360 / 720,896     | —                                            | 1 / 0 / 1; 1×10,000; 7                                                |           1.0 / 1.0 |
| `bodies-256`                 |        0.2 |          1.5 | 196,608 / 327,680 / 393,216       | —                                            | 1 / 0 / 1; 1×1; 7                                                     |           0.2 / 0.4 |
| `fe-quad-shell-visual`       |        0.1 |          1.5 | 196,608 / 327,680 / 393,216       | —                                            | 1 / 0 / 1; 1×1; 7                                                     |           0.2 / 0.5 |
| `fe-quad8-shell-visual`      |        0.1 |          1.4 | 196,608 / 393,216 / 393,216       | —                                            | 1 / 0 / 1; 1×1; 7                                                     |           0.3 / 0.6 |
| `fe-hex8-solid-visual`       |        0.1 |          1.4 | 196,608 / 393,216 / 524,288       | —                                            | 1 / 0 / 1; 1×1; 7                                                     |           0.8 / 1.5 |
| `fe-tet4-solid-132k`         |        0.2 |          1.9 | 393,216 / 524,288 / 589,824       | moving 9.4 / 10.3 ms, 0 / 0                  | 1 / 0 / 1; 1×1; 7                                                     |        59.7 / 119.3 |
| `fe-hex8-orientation-visual` |        0.2 |          1.6 | 262,144 / 524,288 / 524,288       | —                                            | 1 / 0 / 1; 1×1; 7                                                     |           0.8 / 1.5 |
| `fe-hex20-solid-visual`      |        0.1 |          1.5 | 262,144 / 393,216 / 458,752       | —                                            | 1 / 0 / 1; 1×1; 7                                                     |           1.0 / 2.0 |

The instancing overlay submatrix used the same scene and deterministic moving
camera: surface 119.5 FPS (p95 9.8 ms, max 10.5 ms, no interval over 16.7 or
33.3 ms), nodes 87.6 FPS (p95 12.5 ms, max 13.2 ms, no interval over either
threshold), native edges 119.6 FPS (p95 10.1 ms, max 10.3 ms, no interval over
either threshold), and edges plus nodes 65.3 FPS (p95 17.2 ms, max 19.0 ms,
22 intervals over 16.7 ms, none over 33.3 ms). The combined overlay therefore
remains the explicitly accepted reference miss against the 16.7 ms p95 target;
it is not a reason to thin authored topology or add a public quality enum.

The matrix's 390×844 mobile check uses the same weighted/base render-target
accounting at DPR 3: 239,957,640 / 94,798,080 bytes. Desktop and mobile
screenshots were visually inspected for the origin triad, edges/nodes, scalar
results, deformation, orientation glyphs, section caps, legends, and responsive
controls. The focused Chrome contract suite exercises selection and weighted
transparency transitions as well; those semantic checks are intentionally
separate from the queue and timestamp measurements, so a nonblank capture is
not mistaken for a timing sample.

The planar-grid generator is shared by the visual performance fixture and the
benchmark case factory, so their geometry/count conventions cannot drift. Each
case creates one renderer over the same deterministic scene, drains
`GPUQueue.onSubmittedWorkDone()` for a cold upload/first frame, then reuses that
renderer through warmup and timed steady-state samples. The upload/attachment
estimate is the cold first-frame and visible-frame difference. After priming
reusable pick targets and applying a camera-reference invalidation, it measures
the combined lazy pick snapshot plus readback and then a cached-snapshot
readback; the pick-snapshot estimate is their difference. The report retains
both directly measured totals alongside the estimates. When the adapter exposes
`timestamp-query`, the benchmark requests that feature only for this run and
adds delayed, rotating-readback pass timings to `gpuTimestamps`. These timings
are reported separately from synchronous CPU encoding and queue-drained wall
time, with unit/period, p50/p95/p99, sample count, and invalid/disjoint
accounting for each logical pass. Unsupported adapters report an explicit
unavailable shape and allocate no query resources.

The structured FE cases use the validated `createElement` and
`elementPart` path with shared corner and mid-edge node ids. The
report adds `structuredFamily`, `uniqueElementCount`,
`submittedElementOccurrences`, `nodeCount`, and `faceCount`, alongside
`modelBuildMs` and `runtimeCompileMs`, so FE construction/tessellation and
runtime compilation remain separate from first-upload and steady visible-frame
GPU timings. Quad and Quad8 shells retain every surface face; the one-body Hex8
and Hex20 benchmark fixtures retain complete authored face metadata for
selection and picking but use a validated boundary-face subset for their
submitted exterior draw order. Consequently their unique-triangle count
includes retained interior tessellation while submitted-triangle count reflects
the compact exterior order. The Tet4 case uses a conforming 28×28×28 lattice
with six Tet4 elements per cell: it retains 131,712 authored elements, 24,389
shared nodes, and 526,848 complete faces for picking and through-intersection
selection, while submitting only 9,408 exterior triangles. The final
system-Chrome report measured a 2.02 s model build, 585.4 ms attachment and
first frame, 1.9 ms visible-frame p95, and 9.41 ms moving-camera interval p95
with no interval over 16.7 ms. A 35×35×35 candidate (257,250 Tet4 elements)
is not in the bounded browser matrix, and a million-element tier is likewise
not claimed under the current full-topology retention contract. GPU
visible-region selection readback remained under 7.2 ms in the three measured
rectangles. A separate warmed host-side
Through query returned 11,372 elements from an 80×80 rectangle in 116 ms and
all 131,712 elements from the full viewport in 45 ms; Through remains a
completed-gesture query rather than per-frame work. The
12×12×12 Hex20 capacity tier is local-only under `RUN_PERF_LARGE=1`.
In this matrix, **unique elements** means authored logical element records,
while **submitted element occurrences** means the number of element occurrences
represented by the submitted visible topology; it must not be replaced with
one aggregate record for a grid or body. The matrix deliberately keeps unique
triangles and submitted triangles as separate columns because instancing
changes the latter only.

Triangle/Tri6 and Tet4/Tet10 belong to the same contract: Triangle families
represent authored surface elements, and Tet families represent authored volume
elements whose intended faces are exposed. The bounded matrix includes Tet4;
Tet10 remains outside this benchmark fixture. Quadratic variants retain their
authored mid-edge node ids.
The fixture must report the family and logical-element count whenever those
values are relevant; a generic triangle count alone is insufficient evidence.

`timings.visibleFrameMs` is a queue-drained wall-time diagnostic: it includes
JavaScript command encoding and GPU completion and is not a GPU-only duration.
`timings.uploadAndFirstFrameCpuMs` and `timings.visibleFrameCpuMs` record only
the synchronous `renderer.render()` call and command encoding with
`performance.now()`. Keep these measurements separate when diagnosing zoom or
overlay interaction. `gpuTimestamps` is a separate opt-in diagnostic when the
adapter exposes it; it never maps a readback in the same encoded frame. The
case-level `presentation` metadata records node sprite CSS/device size, DPR,
resolved MSAA sample count, the camera-space point-size projection proxy, and
the CPU draw/instance proxy label so node measurements cannot be mistaken for
a fragment-only duration.

The JSON report identifies the browser user agent, adapter identity and fallback
status, enabled features, resolution, DPR, FE family, unique/submitted element
counts, triangle counts, timings, and an estimated renderer-owned
buffer/render-target memory breakdown. Benchmark cases have no active scalar
table, so active result-color allocations are not modeled; the shared 16-byte
empty result binding is included in `fixedBufferBytes`. The breakdown includes
expanded main geometry and materialized optional presentation-edge geometry,
topology/pick metadata, face-subset buffers, mandatory instance records and
ordinary visible order, shared empty order/highlight/deformation sentinels,
pooled pick readback, and the multisampled visible color targets. It excludes
node-presentation sidecars, interaction growth, build temporaries, JavaScript
object heap, and driver allocations. The default triad-enabled weighted path
accounts for 81 logical render-target bytes per physical pixel: MSAA
color/depth, resolved opaque color, `rgba16float` accumulation, and scalar
`r8unorm` revealage. A frame with no weighted contributor retains only the
32-byte MSAA color/depth base and skips OIT target allocation and the composite
pass. The report separately records retained GPU buffers, measurable CPU scene
typed arrays, and an upload-staging upper bound. Edge/topology categories remain
explicit upper bounds where exact deduplication is performed during renderer
upload; schema-12's dense-edge allocation fields are exact only for their
documented bodyless, faceless Triangle builder boundary.

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

The full-screen demo exposes seven user-facing FE/product stories through the
ordinary model catalog and a discoverable **Performance Lab** switch. The switch
reveals the deterministic capacity cases from `demo/benchmark/model.ts` and the
shared `demo/fixtures/planar-grid.ts` generator as lazy entries; ordinary startup
creates no benchmark geometry or capacity work, and a case builds only after it
is selected. The workbench can mesh a cubic Tet4 solid on demand
(`?tet4=<cells>` or the Cells control) through the same dense worker and
canonical reconstruction used by the fixed Tet4 cases. Dynamic sizes remain
outside the fixed `npm run bench:webgpu` matrix. The benchmark owns reproducible cost breakdowns, while diagnostics
may still consume the retained `Performance · 2.10M triangles` fixture directly.
The catalogs and benchmark are subject to [[requirements/demo-fixtures|the same
fixture contract]]; issue #526 remains the work tracker until the migration is
complete, after which the linked requirement is the durable source of truth.

The toolbar's **Continuous** control is a separate, explicit inspection aid and
is off by default. While enabled, the demo chains one `Viewport.invalidate()`
after each completed frame and reports a bounded rolling sample (warmup state,
duration, frame count, average FPS, p50/p95 interval, and longest interval) in
the existing diagnostics HUD. These are refresh-rate-limited RAF/render-loop
statistics, not queue-drained GPU timings. Disabling the control returns the
demo to true render-on-demand idle behavior; `npm run bench:webgpu` remains the
owner of queue-drained capacity measurements.

## Interactive quality policy

Issue [#628](https://github.com/dirkphilip/femgx/issues/628) asked whether the
measured performance envelope justified a new interactive quality mode. The
opt-in benchmark was run in system Chrome 151 on Apple Metal 3 with a real
WebGPU adapter (`isFallbackAdapter: false`), at 800×600 and DPR 1, with two
untimed warmups and seven timed samples across all 13 default cases. The final
report is pinned to merged SHA `86f55e5` above.

| Measurement                           | Observed result                              |
| ------------------------------------- | -------------------------------------------- |
| Settled visible-frame p95             | 1.4–6.9 ms across the matrix                 |
| Representative moving-camera RAF      | 119.5–119.6 FPS; zero intervals over 16.7 ms |
| One-time upload/first-frame p95       | 6.1–729.6 ms, depending on geometry          |
| Default weighted target estimate      | 38,880,000 bytes at 81 bytes/physical pixel  |
| No-weighted-contributor base estimate | 15,360,000 bytes at 32 bytes/physical pixel  |
| 390×844 DPR 3 weighted/base estimates | 239,957,640 / 94,798,080 bytes               |

All 13 cases completed. The default path retained weighted transparency, while
focused real-Chrome checks covered the lazy no-OIT path, transparency ordering,
depth weighting, picking, the origin triad, and the 390×844 mobile viewport.
The results show an upload-cost envelope worth documenting, but no repeatable
steady-state interactive miss on the measured device.

The original matrix did not justify a public quality control. The final dense
overlay evidence changed the implementation priority without changing that API
decision: native one-device-pixel presentation edges measure 119.6 FPS, while
the combined edge/node path measures 65.3 FPS with a 17.2 ms p95 and remains
the accepted dense-overlay miss. The durable targets and
diagnostic process are defined in
[[engineering/gpu-performance|GPU rendering performance]].

The decision gate is therefore:

1. The concrete value of a new control would be recovering interaction on
   hardware with a broad, repeatable frame-time miss. This evidence does not
   show that miss.
2. The minimum useful behavior is the existing optimized default, lazy OIT
   allocation, and explicit `originTriad: false` for callers that do not want
   the renderer-owned triad.
3. Internal minimal/topology/feature pipeline admission and empty/sparse/dense
   storage are required implementation strategies, not user-visible quality
   modes. No DPR cap, render-scale control, hardware tier, or demo switch is
   approved.
4. Cross-device universal thresholds, automatic semantic degradation, and
   fallback rendering remain out of scope.
5. No new public API or abstraction is necessary. A future regression should
   open a focused issue with comparable real-adapter evidence.

The interactive quality policy remains **no public quality control for now**.
Optimize the truthful admitted presentation first. If dense nodes cannot meet
the reference budget without changing semantics, open an explicit product
decision rather than silently reducing them. Do not infer a universal capacity
guarantee from one adapter.

## Package bundle budget

The root package smoke test admits at most 445,000 raw bytes and 110,000 gzip
bytes. The raw ceiling includes the internal packed semantic consumers required
for dense upload, picking, visibility, selection, sections, bounds, and result
orientation; their constructor and validation path remains outside the public
facade. Keep the gzip ceiling unchanged and treat further growth as a design
review trigger rather than weakening both limits together.

[engineering/quality-gate|Quality gate]: quality-gate.md
[engineering/gpu-performance|GPU rendering performance]: gpu-performance.md
