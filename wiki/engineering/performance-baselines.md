# Performance baselines

This note defines the local interaction targets and the format for recording a
machine-specific reference. It complements the asymptotic CI guards in
[[engineering/benchmarks|Benchmarks and performance budgets]] and the real
adapter evidence in [[engineering/gpu-performance|GPU rendering performance]].

## Interaction targets

These are reference targets for the supported interaction path, not a claim of
universal hardware capacity:

- Continuous input CPU work: p95 ≤ 8 ms.
- Buttonless mouse/pen hover scheduling: at most one submitted query per
  animation frame, at most one query in flight, and at most one newest query
  queued; touch hover remains immediate.
- End-to-end interaction: p95 ≤ 16.7 ms with no interval over 33.3 ms.
- Direct sparse visibility/style mutations: CPU p95 ≤ 16.7 ms.
- CPU bulk selection, recolor, or scalar snapshot construction: p95 ≤100 ms for
  the host-side construction phase; renderer synchronization and first-frame
  evidence remain separate.
- Steady frames after an operation: p95 ≤ 16.7 ms.

Structural updates, model construction, and upload are capacity/throughput
trends rather than interaction gates. Default CI budgets remain deliberately
loose, approximately 10× the measured median, and scaling series retain their
≤3× normalized-cost-spread guard.

## Local CPU operation report

The opt-in operation matrix uses the existing realistic Tet4, body-heavy, and
scene fixtures. It measures two untimed warmups and seven timed samples per
operation, then records p50 (the median) and p95 wall-clock milliseconds. Every
mutating operation restores its immutable state before the next sample.

Run it without writing a file:

```sh
npm run bench:operations
```

Write the same single JSON report to an explicit path:

```sh
PERF_BASELINE_FILE=perf-reports/<machine>-<sha>-operations.json npm run bench:operations
```

The report fingerprints the Git SHA, tracked-dirty boolean, ISO timestamp, Node
version, platform/architecture, CPU model, logical-core count, warmup count,
timed sample count, operation name, workload unit/count, optional numeric
workload details, and p50/p95 timings.
It is benchmark evidence only; it does not add a public API or a CI timing gate.
Absolute p50/p95 values remain the primary per-operation record; normalized
costs are secondary comparisons across workload sizes. The CPU suite includes
immutable interaction diff preparation and, for the sparse-highlight case,
renderer CPU table encoding/mirror diff plus fake queue writes. It does not
claim real GPU submission, upload completion, draw, first-frame, or
post-operation frame smoothness; those metrics remain owned by the opt-in
WebGPU phases in
`demo/benchmark/selection.ts` and `demo/benchmark/measurement.ts`.

Body-level coloring is a required workload, not an optional stress feature.
The matrix therefore retains the 256-body recolor-and-clear case and records
its absolute latency even when another subsystem is the current optimization
focus.

### Operation coverage roadmap

Each workflow is split into state construction, renderer synchronization,
first response, and steady-frame cost where those phases exist. A fast steady
frame never substitutes for a slow mutation immediately before it.

| Workflow                | Reference load                                                              | Evidence now                                                           | Missing next evidence                             |
| ----------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------- |
| Select half/all         | 65,856 / 131,712 Tet4 elements                                              | CPU dense payload/range construction; real-WebGPU all-selection phases | Half-selection first/steady WebGPU frame          |
| Hover over selection    | 131,712 unchanged selected elements                                         | CPU viewport/renderer diff; bounded scheduler                          | Coalesced GPU readback and hit resolution         |
| Element inspection/pick | 131,712 elements; 526,848 faces; 24,389 nodes; 9,408 exterior triangles     | CPU direct/deepest `resolvePickHit`; cached dense identity/adjacency   | Real GPU/readback evidence; 1M-element scaling    |
| Hide/show elements      | 8 sparse elements; up to 262,144 faces                                      | CPU state; renderer skin scaling                                       | Absolute half-hidden sync and first frame         |
| Recolor bodies          | 256 bodies / 16,384 elements                                                | CPU override construction and clear                                    | Renderer sync, first frame, 1,024-body tier       |
| Apply scalar results    | 16,384 unique authored elements per scalar table; 1/8/64 placement fixtures | CPU snapshot build and one CPU hover transition                        | Renderer sync, GPU upload, and first/steady frame |
| Visible box selection   | narrow, shell, broad rectangles                                             | Real-WebGPU readback/application phases                                | Hover-adjacent repeated-query latency             |
| Through box selection   | 131,712 Tet4 elements                                                       | Existing completed-gesture host timings                                | Stable local baseline row on this machine         |
| Section and cap rebuild | solid FE part with active results                                           | Correctness coverage                                                   | Bounded absolute and scaling benchmark            |
| Structural scene update | 200,000 placements                                                          | Packed-runtime rebuild                                                 | Viewport reconciliation and first frame           |
| Model build/upload      | 131,712 Tet4; local larger tiers                                            | Existing browser build/upload and CPU scaling                          | Post-optimization million-element capacity        |

The next benchmark should be added when its owning implementation problem is
taken up; this keeps the matrix truthful without constructing a second mock
renderer or expanding product scope.

### Current local reference

Apple M3 Pro (11 logical cores), Node 24.18.0, clean commit `61d7ec8c`;
schema-2 CPU report with 14 operations, two warmups, and seven timed
samples. WebGPU is not measured by this table:

| Operation                                   | Workload                                                                                   |  p50 ms |  p95 ms | CPU-only target                       | CPU-only status                                                     |
| ------------------------------------------- | ------------------------------------------------------------------------------------------ | ------: | ------: | ------------------------------------- | ------------------------------------------------------------------- |
| Half selection and clear                    | 65,856 elements                                                                            |  12.369 |  20.002 | ≤100 ms state construction            | CPU target met; renderer sync/first frame open                      |
| All selection and clear                     | 131,712 elements                                                                           |  27.103 |  27.402 | ≤100 ms state construction            | CPU target met; renderer sync/first frame open                      |
| Hover diff over unchanged selection         | 131,712 elements                                                                           |   0.008 |   0.026 | ≤8 ms interaction diff                | CPU target met; renderer sync/first frame open                      |
| Sparse visibility and restore               | 8 elements                                                                                 |   0.013 |   0.024 | ≤16.7 ms state mutation               | CPU target met; renderer sync/first frame open                      |
| Body recolor and clear                      | 256 bodies                                                                                 |   2.485 |   5.594 | ≤100 ms override construction         | CPU target met; renderer sync/first frame open                      |
| Elemental snapshot build (1 placement)      | 16,384 unique authored elements                                                            |   1.142 |   2.115 | ≤100 ms snapshot construction         | CPU target met; GPU upload/first frame open                         |
| Elemental snapshot build (8 placements)     | 16,384 unique authored elements                                                            |   0.580 |   0.616 | ≤100 ms snapshot construction         | CPU target met; GPU upload/first frame open                         |
| Elemental snapshot build (64 placements)    | 16,384 unique authored elements                                                            |   0.591 |   1.174 | ≤100 ms snapshot construction         | CPU target met; GPU upload/first frame open                         |
| Active-result CPU hover/identity transition | 1 transition                                                                               |   0.002 |   0.005 | ≤8 ms interaction transition          | CPU target met; renderer sync/first frame open                      |
| Direct element pick near last id            | 1 hit; 131,712 elements; 526,848 faces; 24,389 nodes; 6,419,736-byte CSR arrays            |   0.001 |   0.007 | ≤8 ms pick resolution                 | CPU target met; cold setup observed separately; GPU open            |
| Deepest triangle pick near last ids         | 1 hit; 131,712 elements; 526,848 faces; 24,389 nodes; adjacency; 6,419,736-byte CSR arrays |   0.008 |   0.009 | ≤8 ms pick resolution                 | CPU target met; cold setup observed separately; GPU open            |
| Sparse highlight one-record hover           | 1 active record; 131,712 high-water records; 2,097,152 retained slots                      |   0.015 |   0.028 | ≤8 ms renderer CPU table/diff         | CPU/fake-GPU target met; real GPU submission/upload/draw/frame open |
| Scene-runtime rebuild                       | 200,000 placements                                                                         | 148.470 | 155.355 | Capacity trend; no CPU latency target | CPU capacity trend; viewport/frame open                             |
| Part visibility toggle                      | 1,000 placements                                                                           |   0.161 |   0.176 | ≤16.7 ms state mutation               | CPU target met; renderer sync/first frame open                      |

Repeated placements reuse one 16,384-element authored scalar table. The 1/8/64
snapshot rows retain fixture coverage while reporting the same unique authored
data workload; the interaction row measures one CPU hover/identity transition,
not placement scaling or renderer work. State-only rows intentionally leave
ordinary renderer synchronization open; the sparse-highlight row covers
renderer CPU encoding/diff and fake queue writes only. Real queue completion,
upload, draw, and first/steady-frame evidence remain open for all rows on the
real-WebGPU lane. The direct pick row is a diagnostic element-only id near the
last authored element. The deepest pick row replays the last rendered exterior
triangle's element, face, and node ids after renderer-side subset/index setup;
it validates the returned node and element identity and resolves adjacency in
the timed call. Both rows measure CPU hit resolution only, not GPU submission,
readback, upload completion, draw, or frame time. The 6,419,736-byte figure
covers only the two retained node-to-triangle-face CSR typed arrays on this
fixture; Maps and object overhead are excluded. One observed cold, unsampled
`PartSemanticIndex` construction for this distinct `Part` identity took
213.350542 ms in this clean run. Attachment eagerly pays that construction for
each distinct or replacement `Part` identity, outside the per-pick timings.

## Dense selection synchronization seam

The local dense-selection seam is an opt-in seven-row matrix:

```sh
PERF_BASELINE_FILE=perf-reports/<machine>-<sha>-selection-sync.json \
  npm run bench:selection-sync
```

The Tet4 fixture has 131,712 authored elements, 526,848 authored triangle-face
descriptors (`triangles.faces.length`), 9,408 exterior face-subset entries, and
a 16,468-byte dense payload containing 4,116 `Uint32` words. Fixture creation,
semantic indexing, interaction construction, and selection storage allocation
are outside the timed regions. Each build row uses nine fresh equivalent
interaction identities (two warmups and seven samples), then times
`collectDenseElementSelections` followed by `writeDenseSelectionData` into
preallocated storage and validates the first/last membership and packed bits.
This is the comparable collect-plus-pack boundary: after the typed-bitset change,
packing work is performed during collection and the write phase only copies
words. The copy phase is therefore not reported as an independent end-to-end
speedup. The draw rows separately time
`buildSelectionDrawCalls`; they do not claim GPU submission, upload completion,
draw, or frame smoothness.

Eligible exterior triangle parts retain a neighbor-to-selected-owner CSR so
dense skin construction can traverse the smaller unselected complement instead
of scanning all 526,848 authored face descriptors. The probe records 12,159
neighbor-face entries for half selection, 3 for all-but-one, and 0 for all.
This fixture retains 2,596,612 bytes for that CSR, in addition to 6,419,736
bytes for the node-to-triangle-face CSR used by inspection: 9,016,348 typed-array
bytes in total. Maps and object overhead are excluded. Parts without an exterior
face subset or with non-local neighbor topology do not allocate the neighbor
CSR and retain the generic scan.

### Current selection-sync reference

The following is the clean Apple M3 Pro / Node 24.18.0 snapshot from the final
selection-sync harness and production commits; the JSON artifact remains the
source of truth and the changelog records the before/after milestones.

| Operation                       | Workload         | p50 ms | p95 ms | Evidence boundary                 |
| ------------------------------- | ---------------- | -----: | -----: | --------------------------------- |
| Half build dense payload        | 65,856 elements  |  1.779 |  1.894 | CPU collect + pack                |
| Half build draw ranges          | 65,856 elements  |  6.321 |  7.269 | CPU complement/range construction |
| All-but-one build dense payload | 131,711 elements |  3.160 |  3.432 | CPU collect + pack                |
| All-but-one build draw ranges   | 131,711 elements |  0.013 |  0.017 | CPU complement/range construction |
| All build dense payload         | 131,712 elements |  2.893 |  3.066 | CPU collect + pack                |
| All build draw ranges           | 131,712 elements |  0.001 |  0.001 | CPU full-selection shortcut       |
| Unchanged repeat collect cache  | 131,712 elements |  0.000 |  0.010 | CPU identity-cache hit            |

## Dense node-selection synchronization

Run the opt-in local CPU/fake-GPU matrix with:

```sh
PERF_BASELINE_FILE=perf-reports/<machine>-<sha>-node-selection.json \
  npm run bench:node-selection-sync
```

The current clean Apple M3 Pro / Node 24.18.0 reference is commit
`c5293aad5169aa0f7204bd262fb3e999b9170624`. Its source artifact is
`28-local-node-selection-dense.json`. Rows are isolated and non-additive:

| Operation                              | Workload                               | p50 ms | p95 ms | Evidence boundary                             |
| -------------------------------------- | -------------------------------------- | -----: | -----: | --------------------------------------------- |
| Cold node sprite expansion             | 24,389 centers; 2,146,232 output bytes |  0.332 |  0.393 | CPU allocation + scalar typed-array fill      |
| Cold node topology                     | 526,848 owners; 9,112,460 output bytes | 14.346 | 99.124 | CPU count/fill + order check; allocation tail |
| Half immutable interaction state       | 12,194 selected nodes                  |  0.687 |  0.753 | CPU immutable state construction              |
| Half dense membership                  | 12,194 selected; 3,056-byte payload    |  0.136 |  0.372 | CPU classification + profitable bitset        |
| Half fresh highlight encode/copy       | 3,200-byte fresh storage               |  0.008 |  0.014 | CPU encoding + fake queue copy                |
| All immutable interaction state        | 24,389 selected nodes                  |  1.495 |  1.669 | CPU immutable state construction              |
| All dense membership                   | 24,389 selected; 3,056-byte payload    |  0.204 |  0.225 | CPU classification + profitable bitset        |
| All fresh highlight encode/copy        | 3,200-byte fresh storage               |  0.007 |  0.009 | CPU encoding + fake queue copy                |
| 32-occurrence selected-node order sync | one selected node in each occurrence   |  0.028 |  0.036 | isolated CPU + fresh fake order buffers       |

The topology p95 is the maximum-like tail of seven cold 8.69 MiB allocations on
this small sample count, not a steady-frame latency. It is retained because it
exposes the GC risk that the median hides. The implementation has no per-node
JS objects or strings: canonical owner order stays linear, noncanonical input
sorts each node's bounded owner slice in-place, and point-sprite expansion uses
scalar typed-array writes without per-sprite views or mapped arrays.

### Current real-WebGPU node reference

The clean system-Chrome run on this Apple Metal 3 adapter used an 800×600,
DPR-1, four-sample viewport and the 131,712-element / 24,389-node Tet4 case:

| Phase               | Targets | State ms | Sync ms | First frame ms | Steady p50 / p95 ms | Clear ms |
| ------------------- | ------: | -------: | ------: | -------------: | ------------------: | -------: |
| Half nodes, cold    |  12,194 |    0.900 |   0.400 |        125.600 |       2.400 / 4.400 |    1.200 |
| All nodes, resident |  24,389 |    1.000 |   0.900 |          2.400 |       1.900 / 2.200 |    1.200 |

Each phase uses one 3,056-byte dense membership payload in 3,200 bytes of
highlight storage. Each visible and hidden node replay is one instance and
146,334 indices. Desktop and actual 390×844 system-Chrome captures were
nonblank and showed the selected nodes. The cold half-node first frame remains
above the 16.7 ms interaction target; the resident path and steady frames meet
it.

The original object-heavy cold path was observed at 311.9 ms with the same
hardware, fixture, and schema-11 lane. Dense typed topology and zero-churn
sprite expansion reduce the final integrated cold observation to 125.6 ms, a
2.48× improvement. Clean runs of this one-shot phase ranged from 50.5 to
125.6 ms, consistent with the separately measured allocation tail; resident
selection remained stable. The remaining cold work includes about 14 ms median
CPU topology construction plus topology packing, GPU buffer creation/upload,
and the frame. At a projected one million nodes and roughly four million owner
occurrences, current raw topology, packed topology, sprite outputs, and build
temporaries can peak around 284–304 MiB of typed arrays before source mesh and
native queue copies. Direct construction into the final packed allocation and
eventual one-center procedural sprite storage are the next measured memory and
first-use targets; they are not claims of current one-million-node readiness.

## Many-piece real-WebGPU reference

The current clean many-piece source of truth is implementation SHA
`c52e4ea9d8648436f6c24500b61b8241f09cf278` and schema-12 reports
`34-local-many-parts-1000-after-affected-sync.json` and
`35-local-placements-10k-after-affected-sync.json`. Reports 30 and 31 remain
the clean pre-package real-WebGPU references. System Chrome 151 used the Apple
Metal 3 adapter, 800×600 at DPR 1, two warmups, and seven timed steady samples.
The distinct-part and shared-placement meanings are deliberately separate.

| Case                     | Model / runtime / renderer ms | Attach / first CPU / queue ms | Steady CPU / queue p50/p95 ms | Final opaque calls / indices / instances |
| ------------------------ | ----------------------------: | ----------------------------: | ----------------------------: | ---------------------------------------: |
| 1,000 distinct parts     |            128.0 / 1.3 / 34.8 |         410.2 / 390.9 / 417.2 |             0.8/1.0 · 5.9/6.1 |                1,000 / 2,904,000 / 1,000 |
| 10,000 shared placements |              5.8 / 6.5 / 34.9 |              9.5 / 4.0 / 13.9 |             0.1/0.1 · 2.6/4.4 |                         1 / 384 / 10,000 |

The interaction tuple below is target/state/slot-resolution/sync, followed by
first frame, steady queue p50/p95, and clear. Apply/clear writes are exact
`targetCount × 96` bytes. Selection's draw tuple applies independently to
selected-visible and selected-hidden; recolor retains the case's full opaque
tuple.

| Case / selection | Targets |   Interaction ms | First · steady · clear ms | Apply / clear bytes | Selected draw calls / indices / instances |
| ---------------- | ------: | ---------------: | ------------------------: | ------------------: | ----------------------------------------: |
| Parts one        |       1 |  0.0/0.1/0.0/0.6 |       6.0 · 5.7/6.1 · 5.9 |             96 / 96 |                             1 / 2,904 / 1 |
| Parts half       |     500 |  0.0/0.2/0.0/3.6 |      14.6 · 9.2/9.4 · 9.7 |     48,000 / 48,000 |                     500 / 1,452,000 / 500 |
| Parts all        |   1,000 |  0.0/0.1/0.2/4.6 |   20.9 · 12.3/12.6 · 11.3 |     96,000 / 96,000 |                 1,000 / 2,904,000 / 1,000 |
| Placements one   |       1 |  0.0/0.1/0.1/0.5 |       2.8 · 2.3/2.7 · 2.8 |             96 / 96 |                               1 / 384 / 1 |
| Placements half  |   5,000 | 0.2/0.5/0.4/10.7 |      4.1 · 3.3/3.7 · 10.1 |   480,000 / 480,000 |                           1 / 384 / 5,000 |
| Placements all   |  10,000 | 0.1/0.7/0.6/14.2 |      4.6 · 4.1/4.9 · 16.4 |   960,000 / 960,000 |                          1 / 384 / 10,000 |

Reports 34 and 35 retain the exact current recolor, visibility, replacement,
pick, draw, and write rows. Reports 30 and 31 retain the corresponding
pre-package rows; those operations are not summarized here because this
milestone changes affected-part targeting and cold attachment, not their public
contracts.

| Case                     |  Geometry / pick / instance bytes | Highlight / deformation / fixed / readback bytes |        Retained / CPU scene / staging / peak bytes | Render targets |
| ------------------------ | --------------------------------: | -----------------------------------------------: | -------------------------------------------------: | -------------: |
| 1,000 distinct parts     | 46,464,000 / 46,480,000 / 100,000 |                            144 / 4 / 324 / 1,280 | 93,045,752 / 26,492,000 / 92,944,000 / 185,989,752 |     48,480,000 |
| 10,000 shared placements |         6,144 / 6,160 / 1,000,000 |                            144 / 4 / 324 / 1,280 |           1,014,056 / 643,804 / 12,304 / 1,026,360 |     48,480,000 |

Edge-index and subset bytes are zero in both cases. These capacities are
unchanged from reports 30/31 because the package removes CPU scans and temporary
encoding records rather than GPU resources. The retained estimate excludes node
sidecars, interaction growth, construction temporaries, JavaScript heap, and
driver allocations; staging and render targets are separate. Full methodology
and exact assertions are in
[[engineering/benchmarks#current-affected-part-and-cold-attachment-evidence|Benchmarks]].

The public `setPartOccurrenceOverrides` bulk immutable transition reduces the clean
10,000-placement half/all state rows to 1.2/1.2 ms. Same-session pre-edit
observations were 427.3/1,823.9 ms, or 356.1×/1,519.9× slower, but have no
durable clean artifact. A pre-edit synthetic CPU/fake-GPU sparse selection
observation at 100,000 placements was 7.621/7.734 ms p50/p95 with 400,200
uploaded bytes. Clean report 32 records 0.466/0.510 ms and 244 bytes:
16.37×/15.15× faster with 1,640× fewer bytes. Clean report 33 records the direct
cold full-attachment encoder at 0.099/0.609, 0.306/0.459, and 0.955/1.489 ms
for 100/1,000/4,000 shared placements, and 0.289/0.328, 1.727/3.291, and
6.503/19.302 ms for the same distinct-part tiers. The 19.302 ms distinct-4,000
p95 is a retained outlier. Pre-edit three-sample p50 observations were
0.296/1.490/4.569 ms shared and 0.427/4.649/18.563 ms distinct, without a
durable artifact. Public `Viewport.setScene` remained about 47 ms at 16,384
placements before and after, with noisy variation; no end-to-end speedup is
claimed.

## Two-million-triangle real-WebGPU reference

Two capacity cases deliberately keep reuse and unique ownership separate:

- `instanced-2.10m` is the common interactive workload: 16,384 authored Quad
  elements, 32,768 unique triangles, 64 placements, and 2,097,152 submitted
  triangles. Reusable geometry amortizes model, topology, and GPU-resource
  construction while retaining placement and interaction work.
- `unique-2m-local` is the unique-ownership stress workload: 2,000,000 distinct
  Triangle elements and triangles, 1,002,001 nodes, and one placement. It makes
  scene construction, dense selection, and lazy node/edge presentation costs
  visible instead of hiding them behind instancing.

The current unique-geometry source of truth is clean implementation SHA
`b7ab6b37ce878626e52736b957ea54df1a2567b6` and schema-12 report
`29-local-two-million-triangle.json`. It used system Chrome 151 on the Apple
Metal 3 adapter, 800×600 at DPR 1, two warmups, and seven timed steady samples.
CPU construction/encoding and queue-drained wall time are separate boundaries:

| Workload                            | Exact clean result                                                                                                              |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Surface build and first use         | Model 585.8 ms; runtime 0.1 ms; renderer 39.7 ms; first frame 1,375.2 ms CPU / 1,424.5 ms queue                                 |
| Surface steady/moving               | Queue 3.3 / 24.3 ms p50/p95; moving RAF 119.5 FPS, 10.0 ms p95, 0 intervals over 16.7 ms                                        |
| Element hover                       | Pick 14.3 ms; sync 0.2 ms; first 6.3 ms; steady 6.3 / 7.9 ms; clear 3.1 ms                                                      |
| Half element selection              | 1,000,000 targets; target/state/sync 7.2 / 71.8 / 212.7 ms; first 13.9 ms; steady 10.4 / 11.1 ms; clear 3.4 ms                  |
| All element selection               | 2,000,000 targets; target/state/sync 11.8 / 162.9 / 313.5 ms; first 19.1 ms; steady 10.6 / 14.4 ms; clear 3.3 ms                |
| Hide all / restore                  | Mutation/sync 0.0 / 0.2 ms; first 0.8 ms; steady 0.8 / 0.8 ms; restore 3.1 ms                                                   |
| Cold node presentation              | Sync 0.5 ms; first frame 519.9 ms CPU / 580.7 ms queue; 6,012,006 submitted node indices                                        |
| Incremental cold presentation edges | Sync 0.3 ms; first frame **905.9 ms CPU / 1,003.8 ms queue**; 6,004,000 submitted edge indices                                  |
| Nodes + edges resident              | Fixed/moving 119.611 / 120.002 FPS; RAF p95 9.71 / 9.80 ms; no interval over 16.7 ms                                            |
| Overlay hover / all selection       | Hover pick/sync/first/steady p95 26.2 / 0.5 / 0.5 / 1.0 ms; all-selection target/state/sync/first 24.6 / 221.2 / 293.0 / 1.7 ms |

Half/all selection each use one 250,004-byte dense payload and submit exactly
6,000,000 selected-visible plus 6,000,000 selected-hidden indices. Visibility
asserts 6,000,000 → 0 → 6,000,000 surface indices across hide/restore. Hover,
selection, visibility, nodes, and edges also assert their interaction storage or
draw admission, so a skipped operation cannot appear fast.

The retained renderer-buffer estimate with presentation edges materialized is
768,001,868 bytes; its upload-staging upper bound is 768,000,016 bytes. The
576,000,000-byte retained presentation-edge value is an upper bound, not
combined edge-plus-node memory. Dense edge construction records 252,663,296
exact temporary typed bytes and 264,112,000 final typed bytes, with at least
416,112,000 bytes overlapping during finalization and a 516,775,296-byte
no-intermediate-GC upper bound. Node-presentation sidecars, interaction growth,
general build temporaries, JavaScript object heap, and driver allocations are
excluded from the retained estimate.

The pre-edit presentation-edge path was observed in the same hardware session
at 25,026.7 ms CPU and 25,150.9 ms queue-drained. No durable clean artifact was
recorded for that observation, so it is a baseline observation rather than a
clean-SHA report. Against it, the clean schema-12 result is 27.63× faster on the
CPU boundary and 25.06× faster queue-drained.

## Changelog

Keep one row per intentional milestone and never fill a row with an estimated
number.

| Date       | Git SHA                                    | Machine / Node                         | Matrix                                                                     | p50 / p95 summary                                                                                                                                                                                                                                                                       | Notes                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------- | ------------------------------------------ | -------------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-08-17 | `e8f462b1`                                 | Apple M3 Pro / 24.18.0                 | Before identity diff fix                                                   | Hover 15.213 / 18.288 ms                                                                                                                                                                                                                                                                | `14-local-operations-before-identity-fix`                                                                                                                                                                                                                                                                                                                                                                                          |
| 2026-08-17 | `e8f462b1`                                 | Apple M3 Pro / 24.18.0                 | After identity diff fix                                                    | Hover 0.008 / 0.029 ms                                                                                                                                                                                                                                                                  | `15-local-operations-after-identity-fix`                                                                                                                                                                                                                                                                                                                                                                                           |
| 2026-08-17 | `e8f462b1`                                 | Apple M3 Pro / 24.18.0                 | Before dense result path                                                   | 1M map 104.614 / 149.168 ms                                                                                                                                                                                                                                                             | `16-local-operations-before-elemental-dense`                                                                                                                                                                                                                                                                                                                                                                                       |
| 2026-08-17 | `e8f462b1`                                 | Apple M3 Pro / 24.18.0                 | Dense result path (historical tiered report)                               | Snapshots 1/8/64: 1.150667 / 1.627625, 0.569625 / 0.603125, 0.566500 / 0.589209 ms; active CPU transitions 0.002000 / 0.004125, 0.001417 / 0.002209, 0.001416 / 0.002292 ms                                                                                                             | CPU only; WebGPU not measured. `18-local-operations-elemental-dense-with-snapshot`                                                                                                                                                                                                                                                                                                                                                 |
| 2026-08-17 | `e8f462b1`                                 | Apple M3 Pro / 24.18.0                 | Truthful CPU operation matrix (schema 2, 11 operations)                    | Snapshots 1/8/64: 1.065583 / 1.906791, 0.588375 / 0.675708, 0.550125 / 0.598042 ms; one CPU hover: 0.002041 / 0.004417 ms                                                                                                                                                               | CPU only; WebGPU not measured. `19-local-operations-truthful-workloads.json`; tracked worktree dirty.                                                                                                                                                                                                                                                                                                                              |
| 2026-08-17 | `d969ef1a`                                 | Apple M3 Pro / 24.18.0                 | Before in-place sparse highlight update (high-water, one-record hover)     | **25.650500 / 27.539708 ms**                                                                                                                                                                                                                                                            | CPU/fake-GPU seam; 1 active record, 131,712 high-water records, 2,097,152 retained sparse slots. Setup is outside timing. `20-local-operations-before-highlight-inplace.json`.                                                                                                                                                                                                                                                     |
| 2026-08-17 | `d969ef1a`                                 | Apple M3 Pro / 24.18.0                 | After in-place sparse highlight update (high-water, one-record hover)      | **0.009750 / 0.022292 ms**                                                                                                                                                                                                                                                              | CPU/fake-GPU seam; one active record per invocation, with 131,712 high-water records and 2,097,152 retained slots; real GPU submission/upload/draw/frame remain open. `21-local-operations-after-highlight-inplace.json`.                                                                                                                                                                                                          |
| 2026-08-17 | `b5114ee9`                                 | Apple M3 Pro / 24.18.0                 | BEFORE element inspection/pick resolution (schema 2, 14 operations)        | Direct element **2.473709 / 2.548208 ms**; deepest triangle **9.083542 / 9.551084 ms**                                                                                                                                                                                                  | CPU `resolvePickHit` only; 131,712 elements, 526,848 faces, 24,389 nodes, 9,408 rendered exterior triangles; deepest row resolves adjacency. Setup and renderer-decoded ID preparation are outside timing. `22-local-operations-before-pick-resolution.json`.                                                                                                                                                                      |
| 2026-08-17 | `b5114ee9`                                 | Apple M3 Pro / 24.18.0                 | AFTER indexed element inspection/pick resolution (schema 2, 14 operations) | Direct element **0.001458 / 0.008166 ms**; deepest triangle **0.006459 / 0.010709 ms**                                                                                                                                                                                                  | CPU `resolvePickHit` after cached dense node→triangle-face CSR; 6,419,736 bytes for the two CSR typed arrays only (Maps/object overhead excluded); one observed cold, unsampled `PartSemanticIndex` construction for this distinct `Part` identity **250.930250 ms**, eagerly paid per distinct/replacement `Part` identity by attachment and outside timing. `23-local-operations-after-pick-index.json`.                         |
| 2026-08-17 | `9a5a9f8f966041fd520fca4903fa8a0594d7e7ff` | Apple M3 Pro / 24.18.0                 | BEFORE dense selection collect-plus-pack (7 selection-sync rows)           | Payload half **7.698625 / 11.904708 ms**; all-but-one **12.963000 / 14.972875 ms**; all **13.325958 / 16.409750 ms**; draw half **18.364750 / 21.350041 ms**, all-but-one **22.953250 / 25.787250 ms**, all **8.015666 / 8.130833 ms**; unchanged **0.000333 / 0.008334 ms**            | `24-local-selection-sync-before.json`, clean final harness; `gitDirty: false`. Draw-range values are a separate unchanged/noise baseline; no GPU/frame claim.                                                                                                                                                                                                                                                                      |
| 2026-08-17 | `ef7d58806e5c188e168c105035b791dfc611141e` | Apple M3 Pro / 24.18.0                 | AFTER direct typed-bitset collect-plus-pack (7 selection-sync rows)        | Payload half **1.778709 / 1.893875 ms**; all-but-one **3.159917 / 3.432084 ms**; all **2.892666 / 3.066250 ms**; draw half **20.383417 / 22.806042 ms**, all-but-one **22.362208 / 23.139292 ms**, all **7.930875 / 8.572750 ms**; unchanged **0.000375 / 0.010042 ms**                 | `25-local-selection-sync-after-dense-bitset.json`, clean final harness; `gitDirty: false`. Draw-range values remain a separate unchanged/noise baseline; the measured win is collect-plus-pack.                                                                                                                                                                                                                                    |
| 2026-08-18 | `61d7ec8c1a654b6d5d973bf5df04e979068f7a05` | Apple M3 Pro / 24.18.0                 | AFTER dense selection complement traversal (7 selection-sync rows)         | Payload half **1.919166 / 2.051833 ms**; all-but-one **3.224417 / 3.268875 ms**; all **2.996708 / 3.615583 ms**; draw half **6.321084 / 7.268500 ms**, all-but-one **0.012541 / 0.017166 ms**, all **0.000916 / 0.001042 ms**; unchanged **0.000333 / 0.007458 ms**                     | `26-local-selection-face-ranges-after.json`, clean final harness; `gitDirty: false`. Half exceeds the 1,024-range cap and returns the intentional full-draw fallback. Neighbor CSR is 2,596,612 bytes; real GPU submission/draw/frame evidence remains separate.                                                                                                                                                                   |
| 2026-08-18 | `c5293aad5169aa0f7204bd262fb3e999b9170624` | Apple M3 Pro / 24.18.0                 | Dense node selection and zero-churn node upload (26 node-sync rows)        | CPU sprite **0.331583 / 0.393375 ms**; topology **14.346292 / 99.124375 ms**; half state/dense/upload **0.687208 / 0.752959**, **0.136292 / 0.372167**, **0.007834 / 0.013583 ms**; all state/dense/upload **1.494875 / 1.669417**, **0.204208 / 0.225084**, **0.006625 / 0.009041 ms** | `28-local-node-selection-dense.json`, clean CPU/fake-GPU harness after integrating dense semantic storage; `gitDirty: false`. Final Metal 3 half-node cold first frame **311.9 → 125.6 ms (2.48×)**, with clean observations spanning **50.5–125.6 ms**; resident all-node first frame **2.4 ms**, steady **1.9 / 2.2 ms**. The cold path and projected 1M typed-array peak remain open.                                           |
| 2026-08-18 | —                                          | Apple M3 Pro / Chrome 151              | BEFORE dense presentation-edge builder, same-session observation           | Cold incremental presentation edges **25,026.7 ms CPU / 25,150.9 ms queue-drained**                                                                                                                                                                                                     | Observed pre-edit baseline only; no durable clean JSON artifact and no clean implementation SHA. Retained solely for comparison with the immediately following clean hardware result.                                                                                                                                                                                                                                              |
| 2026-08-18 | `b7ab6b37ce878626e52736b957ea54df1a2567b6` | Apple M3 Pro / Chrome 151              | AFTER integrated dense two-million-Triangle presentation path (schema 12)  | Cold incremental presentation edges **905.9 ms CPU / 1,003.8 ms queue-drained**; surface first **1,375.2 / 1,424.5 ms CPU/queue**; surface steady **3.3 / 24.3 ms**; combined moving RAF **9.80 ms p95**                                                                                | `29-local-two-million-triangle.json`, clean post-rebase real-WebGPU report. **27.63× CPU / 25.06× queue** versus the same-session observation. Exact edge allocation: 252,663,296 construction, 264,112,000 final, 416,112,000 guaranteed overlap, 516,775,296 no-GC upper bound bytes. Retained estimate excludes node sidecars, interaction growth, JS heap, driver, and general build temporaries.                              |
| 2026-08-18 | —                                          | Apple M3 Pro / Chrome 151              | BEFORE many-piece slot/recolor package, same-session observations          | Shared 10k-placement immutable recolor state half/all **427.3 / 1,823.9 ms**; synthetic renderer attachment at 1,024/4,096/16,384 placements **1.113 / 4.274 / 19.276 ms**                                                                                                              | No durable clean JSON or clean SHA for these observations. The recolor values are immutable state construction; attachment is a CPU/fake-GPU seam. Public `Viewport.setScene` at 16,384 placements stayed about **47 ms** before/after with noisy variation, so no end-to-end improvement is claimed.                                                                                                                              |
| 2026-08-18 | `ba7c04c31f506c358992cd974e03aca2bab23983` | Apple M3 Pro / Chrome 151              | Clean schema-12 distinct-part and shared-placement reference               | Parts: build/runtime/renderer **140.2 / 1.2 / 38.9 ms**, first CPU/queue **450.0 / 472.4 ms**, steady queue **5.0 / 5.5 ms**. Placements: **6.1 / 7.2 / 41.0 ms**, **14.3 / 29.1 ms**, **2.3 / 2.5 ms**. Shared recolor state half/all **1.2 / 1.2 ms**                                 | `30-local-many-parts-1000.json` and `31-local-placements-10k.json`, clean real-WebGPU artifacts. The bulk part-occurrence transition is **356.1× / 1,519.9×** faster than the non-artifact recolor observations. Synthetic attachment after: **0.667 / 2.497 / 10.481 ms** (**1.67× / 1.71× / 1.84×**); it is not hardware evidence. Full operation, write, draw, replacement, and memory rows are above.                          |
| 2026-08-18 | `c52e4ea9d8648436f6c24500b61b8241f09cf278` | Apple M3 Pro / Node 24.18 + Chrome 151 | Affected-part targeting and direct cold attachment encoding                | Synthetic sparse selection at 100k: **0.466 / 0.510 ms**, **244 B**; cold attach shared 4k **0.955 / 1.489 ms**, distinct 4k **6.503 / 19.302 ms**. Hardware parts first CPU/queue **390.9 / 417.2 ms**; placements **4.0 / 13.9 ms**.                                                  | `32-local-affected-part-sync.json` and `33-local-cold-attachment.json` are seven-sample CPU/fake-GPU artifacts; `34-local-many-parts-1000-after-affected-sync.json` and `35-local-placements-10k-after-affected-sync.json` are real-WebGPU artifacts. Sparse pre-edit **7.621 / 7.734 ms, 400,200 B** and cold pre-edit three-sample values have no durable artifact. Desktop and 390×844 combined-overlay captures were nonblank. |

To append a milestone, run the command with `PERF_BASELINE_FILE`, inspect the
JSON, then add the exact fingerprint and selected p50/p95 values to this table.
Keep the JSON artifact when the result is useful for later comparison. Compare
CPU reports only on comparable hosts; use the separate opt-in system-Chrome
WebGPU report for browser, adapter, queue, GPU-pass, and memory evidence.

## Scope boundaries

The operation matrix intentionally measures host/CPU interaction work and does
not emulate a CPU renderer. Visible-surface box application remains measured by
the existing GPU `pickRegion` phases; the CPU operation runner does not invent a
second Viewport seam for Through box selection. Through remains a completed
host-side query, and no benchmark may add a GPU pass, readback, fallback
renderer, or generalized geometry-query subsystem. The bounded browser matrix
remains the 131,712-element Tet4 tier; larger full-topology cases are local
capacity experiments only.
