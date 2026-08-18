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
`7f7c16d1d852b5c61224774308b83786d239570e`. Its source artifact is
`28-local-node-selection-dense.json`. Rows are isolated and non-additive:

| Operation                              | Workload                               | p50 ms |  p95 ms | Evidence boundary                             |
| -------------------------------------- | -------------------------------------- | -----: | ------: | --------------------------------------------- |
| Cold node sprite expansion             | 24,389 centers; 2,146,232 output bytes |  0.273 |   0.341 | CPU allocation + scalar typed-array fill      |
| Cold node topology                     | 526,848 owners; 9,112,460 output bytes | 14.006 | 136.408 | CPU count/fill + order check; allocation tail |
| Half immutable interaction state       | 12,194 selected nodes                  |  0.694 |   0.777 | CPU immutable state construction              |
| Half dense membership                  | 12,194 selected; 3,056-byte payload    |  0.108 |   0.384 | CPU classification + profitable bitset        |
| Half fresh highlight encode/copy       | 3,200-byte fresh storage               |  0.006 |   0.012 | CPU encoding + fake queue copy                |
| All immutable interaction state        | 24,389 selected nodes                  |  1.532 |   1.647 | CPU immutable state construction              |
| All dense membership                   | 24,389 selected; 3,056-byte payload    |  0.208 |   0.214 | CPU classification + profitable bitset        |
| All fresh highlight encode/copy        | 3,200-byte fresh storage               |  0.006 |   0.011 | CPU encoding + fake queue copy                |
| 32-occurrence selected-node order sync | one selected node in each occurrence   |  0.029 |   0.036 | isolated CPU + fresh fake order buffers       |

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
| Half nodes, cold    |  12,194 |    1.000 |   0.400 |         51.800 |       2.100 / 5.500 |    1.000 |
| All nodes, resident |  24,389 |    1.100 |   0.900 |          2.300 |       1.900 / 2.100 |    1.400 |

Each phase uses one 3,056-byte dense membership payload in 3,200 bytes of
highlight storage. Each visible and hidden node replay is one instance and
146,334 indices. Desktop and actual 390×844 system-Chrome captures were
nonblank and showed the selected nodes. The cold half-node first frame remains
above the 16.7 ms interaction target; the resident path and steady frames meet
it.

The original object-heavy cold path was observed at 311.9 ms with the same
hardware, fixture, and schema-11 lane. Dense typed topology and zero-churn
sprite expansion reduce the corresponding clean cold result to 51.8 ms, a
6.02× improvement. The remaining cold work includes about 14 ms median CPU
topology construction plus topology packing, GPU buffer creation/upload, and
the frame. At a projected one million nodes and roughly four million owner
occurrences, current raw topology, packed topology, sprite outputs, and build
temporaries can peak around 284–304 MiB of typed arrays before source mesh and
native queue copies. Direct construction into the final packed allocation and
eventual one-center procedural sprite storage are the next measured memory and
first-use targets; they are not claims of current one-million-node readiness.

## Changelog

Keep one row per intentional milestone and never fill a row with an estimated
number.

| Date       | Git SHA                                    | Machine / Node         | Matrix                                                                     | p50 / p95 summary                                                                                                                                                                                                                                                                        | Notes                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------- | ------------------------------------------ | ---------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-08-17 | `e8f462b1`                                 | Apple M3 Pro / 24.18.0 | Before identity diff fix                                                   | Hover 15.213 / 18.288 ms                                                                                                                                                                                                                                                                 | `14-local-operations-before-identity-fix`                                                                                                                                                                                                                                                                                                                                                                  |
| 2026-08-17 | `e8f462b1`                                 | Apple M3 Pro / 24.18.0 | After identity diff fix                                                    | Hover 0.008 / 0.029 ms                                                                                                                                                                                                                                                                   | `15-local-operations-after-identity-fix`                                                                                                                                                                                                                                                                                                                                                                   |
| 2026-08-17 | `e8f462b1`                                 | Apple M3 Pro / 24.18.0 | Before dense result path                                                   | 1M map 104.614 / 149.168 ms                                                                                                                                                                                                                                                              | `16-local-operations-before-elemental-dense`                                                                                                                                                                                                                                                                                                                                                               |
| 2026-08-17 | `e8f462b1`                                 | Apple M3 Pro / 24.18.0 | Dense result path (historical tiered report)                               | Snapshots 1/8/64: 1.150667 / 1.627625, 0.569625 / 0.603125, 0.566500 / 0.589209 ms; active CPU transitions 0.002000 / 0.004125, 0.001417 / 0.002209, 0.001416 / 0.002292 ms                                                                                                              | CPU only; WebGPU not measured. `18-local-operations-elemental-dense-with-snapshot`                                                                                                                                                                                                                                                                                                                         |
| 2026-08-17 | `e8f462b1`                                 | Apple M3 Pro / 24.18.0 | Truthful CPU operation matrix (schema 2, 11 operations)                    | Snapshots 1/8/64: 1.065583 / 1.906791, 0.588375 / 0.675708, 0.550125 / 0.598042 ms; one CPU hover: 0.002041 / 0.004417 ms                                                                                                                                                                | CPU only; WebGPU not measured. `19-local-operations-truthful-workloads.json`; tracked worktree dirty.                                                                                                                                                                                                                                                                                                      |
| 2026-08-17 | `d969ef1a`                                 | Apple M3 Pro / 24.18.0 | Before in-place sparse highlight update (high-water, one-record hover)     | **25.650500 / 27.539708 ms**                                                                                                                                                                                                                                                             | CPU/fake-GPU seam; 1 active record, 131,712 high-water records, 2,097,152 retained sparse slots. Setup is outside timing. `20-local-operations-before-highlight-inplace.json`.                                                                                                                                                                                                                             |
| 2026-08-17 | `d969ef1a`                                 | Apple M3 Pro / 24.18.0 | After in-place sparse highlight update (high-water, one-record hover)      | **0.009750 / 0.022292 ms**                                                                                                                                                                                                                                                               | CPU/fake-GPU seam; one active record per invocation, with 131,712 high-water records and 2,097,152 retained slots; real GPU submission/upload/draw/frame remain open. `21-local-operations-after-highlight-inplace.json`.                                                                                                                                                                                  |
| 2026-08-17 | `b5114ee9`                                 | Apple M3 Pro / 24.18.0 | BEFORE element inspection/pick resolution (schema 2, 14 operations)        | Direct element **2.473709 / 2.548208 ms**; deepest triangle **9.083542 / 9.551084 ms**                                                                                                                                                                                                   | CPU `resolvePickHit` only; 131,712 elements, 526,848 faces, 24,389 nodes, 9,408 rendered exterior triangles; deepest row resolves adjacency. Setup and renderer-decoded ID preparation are outside timing. `22-local-operations-before-pick-resolution.json`.                                                                                                                                              |
| 2026-08-17 | `b5114ee9`                                 | Apple M3 Pro / 24.18.0 | AFTER indexed element inspection/pick resolution (schema 2, 14 operations) | Direct element **0.001458 / 0.008166 ms**; deepest triangle **0.006459 / 0.010709 ms**                                                                                                                                                                                                   | CPU `resolvePickHit` after cached dense node→triangle-face CSR; 6,419,736 bytes for the two CSR typed arrays only (Maps/object overhead excluded); one observed cold, unsampled `PartSemanticIndex` construction for this distinct `Part` identity **250.930250 ms**, eagerly paid per distinct/replacement `Part` identity by attachment and outside timing. `23-local-operations-after-pick-index.json`. |
| 2026-08-17 | `9a5a9f8f966041fd520fca4903fa8a0594d7e7ff` | Apple M3 Pro / 24.18.0 | BEFORE dense selection collect-plus-pack (7 selection-sync rows)           | Payload half **7.698625 / 11.904708 ms**; all-but-one **12.963000 / 14.972875 ms**; all **13.325958 / 16.409750 ms**; draw half **18.364750 / 21.350041 ms**, all-but-one **22.953250 / 25.787250 ms**, all **8.015666 / 8.130833 ms**; unchanged **0.000333 / 0.008334 ms**             | `24-local-selection-sync-before.json`, clean final harness; `gitDirty: false`. Draw-range values are a separate unchanged/noise baseline; no GPU/frame claim.                                                                                                                                                                                                                                              |
| 2026-08-17 | `ef7d58806e5c188e168c105035b791dfc611141e` | Apple M3 Pro / 24.18.0 | AFTER direct typed-bitset collect-plus-pack (7 selection-sync rows)        | Payload half **1.778709 / 1.893875 ms**; all-but-one **3.159917 / 3.432084 ms**; all **2.892666 / 3.066250 ms**; draw half **20.383417 / 22.806042 ms**, all-but-one **22.362208 / 23.139292 ms**, all **7.930875 / 8.572750 ms**; unchanged **0.000375 / 0.010042 ms**                  | `25-local-selection-sync-after-dense-bitset.json`, clean final harness; `gitDirty: false`. Draw-range values remain a separate unchanged/noise baseline; the measured win is collect-plus-pack.                                                                                                                                                                                                            |
| 2026-08-18 | `61d7ec8c1a654b6d5d973bf5df04e979068f7a05` | Apple M3 Pro / 24.18.0 | AFTER dense selection complement traversal (7 selection-sync rows)         | Payload half **1.919166 / 2.051833 ms**; all-but-one **3.224417 / 3.268875 ms**; all **2.996708 / 3.615583 ms**; draw half **6.321084 / 7.268500 ms**, all-but-one **0.012541 / 0.017166 ms**, all **0.000916 / 0.001042 ms**; unchanged **0.000333 / 0.007458 ms**                      | `26-local-selection-face-ranges-after.json`, clean final harness; `gitDirty: false`. Half exceeds the 1,024-range cap and returns the intentional full-draw fallback. Neighbor CSR is 2,596,612 bytes; real GPU submission/draw/frame evidence remains separate.                                                                                                                                           |
| 2026-08-18 | `7f7c16d1d852b5c61224774308b83786d239570e` | Apple M3 Pro / 24.18.0 | Dense node selection and zero-churn node upload (26 node-sync rows)        | CPU sprite **0.272834 / 0.340666 ms**; topology **14.005708 / 136.407959 ms**; half state/dense/upload **0.693833 / 0.777000**, **0.108042 / 0.383750**, **0.006459 / 0.011625 ms**; all state/dense/upload **1.531834 / 1.647084**, **0.207625 / 0.213834**, **0.005792 / 0.010916 ms** | `28-local-node-selection-dense.json`, clean CPU/fake-GPU harness; `gitDirty: false`. Real Metal 3 half-node cold first frame **311.9 → 51.8 ms (6.02×)**; resident all-node first frame **2.3 ms**, steady **1.9 / 2.1 ms**. The cold path remains above target and the projected 1M typed-array peak remains open.                                                                                        |

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
