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

| Workflow                | Reference load                                                              | Evidence now                                    | Missing next evidence                             |
| ----------------------- | --------------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------- |
| Select half/all         | 65,856 / 131,712 Tet4 elements                                              | CPU state; real-WebGPU all-selection phases     | Half-selection first/steady WebGPU frame          |
| Hover over selection    | 131,712 unchanged selected elements                                         | CPU viewport/renderer diff; bounded scheduler   | Coalesced GPU readback and hit resolution         |
| Hide/show elements      | 8 sparse elements; up to 262,144 faces                                      | CPU state; renderer skin scaling                | Absolute half-hidden sync and first frame         |
| Recolor bodies          | 256 bodies / 16,384 elements                                                | CPU override construction and clear             | Renderer sync, first frame, 1,024-body tier       |
| Apply scalar results    | 16,384 unique authored elements per scalar table; 1/8/64 placement fixtures | CPU snapshot build and one CPU hover transition | Renderer sync, GPU upload, and first/steady frame |
| Visible box selection   | narrow, shell, broad rectangles                                             | Real-WebGPU readback/application phases         | Hover-adjacent repeated-query latency             |
| Through box selection   | 131,712 Tet4 elements                                                       | Existing completed-gesture host timings         | Stable local baseline row on this machine         |
| Section and cap rebuild | solid FE part with active results                                           | Correctness coverage                            | Bounded absolute and scaling benchmark            |
| Structural scene update | 200,000 placements                                                          | Packed-runtime rebuild                          | Viewport reconciliation and first frame           |
| Model build/upload      | 131,712 Tet4; local larger tiers                                            | Existing browser build/upload and CPU scaling   | Post-optimization million-element capacity        |

The next benchmark should be added when its owning implementation problem is
taken up; this keeps the matrix truthful without constructing a second mock
renderer or expanding product scope.

### Current local reference

Apple M3 Pro (11 logical cores), Node 24.18.0, dirty worktree based on
`d969ef1a`; schema-2 CPU report with 12 operations, two warmups, and seven timed
samples. WebGPU is not measured by this table:

| Operation                                   | Workload                                                              |  p50 ms |  p95 ms | CPU-only target                       | CPU-only status                                                     |
| ------------------------------------------- | --------------------------------------------------------------------- | ------: | ------: | ------------------------------------- | ------------------------------------------------------------------- |
| Half selection and clear                    | 65,856 elements                                                       |  11.031 |  15.548 | ≤100 ms state construction            | CPU target met; renderer sync/first frame open                      |
| All selection and clear                     | 131,712 elements                                                      |  23.537 |  23.858 | ≤100 ms state construction            | CPU target met; renderer sync/first frame open                      |
| Hover diff over unchanged selection         | 131,712 elements                                                      |   0.008 |   0.026 | ≤8 ms interaction diff                | CPU target met; renderer sync/first frame open                      |
| Sparse visibility and restore               | 8 elements                                                            |   0.012 |   0.025 | ≤16.7 ms state mutation               | CPU target met; renderer sync/first frame open                      |
| Body recolor and clear                      | 256 bodies                                                            |   2.171 |   4.663 | ≤100 ms override construction         | CPU target met; renderer sync/first frame open                      |
| Elemental snapshot build (1 placement)      | 16,384 unique authored elements                                       |   1.018 |   1.655 | ≤100 ms snapshot construction         | CPU target met; GPU upload/first frame open                         |
| Elemental snapshot build (8 placements)     | 16,384 unique authored elements                                       |   0.510 |   0.531 | ≤100 ms snapshot construction         | CPU target met; GPU upload/first frame open                         |
| Elemental snapshot build (64 placements)    | 16,384 unique authored elements                                       |   0.567 |   0.777 | ≤100 ms snapshot construction         | CPU target met; GPU upload/first frame open                         |
| Active-result CPU hover/identity transition | 1 transition                                                          |   0.002 |   0.004 | ≤8 ms interaction transition          | CPU target met; renderer sync/first frame open                      |
| Sparse highlight one-record hover           | 1 active record; 131,712 high-water records; 2,097,152 retained slots |   0.010 |   0.022 | ≤8 ms renderer CPU table/diff         | CPU/fake-GPU target met; real GPU submission/upload/draw/frame open |
| Scene-runtime rebuild                       | 200,000 placements                                                    | 137.265 | 155.485 | Capacity trend; no CPU latency target | CPU capacity trend; viewport/frame open                             |
| Part visibility toggle                      | 1,000 placements                                                      |   0.148 |   0.158 | ≤16.7 ms state mutation               | CPU target met; renderer sync/first frame open                      |

Repeated placements reuse one 16,384-element authored scalar table. The 1/8/64
snapshot rows retain fixture coverage while reporting the same unique authored
data workload; the interaction row measures one CPU hover/identity transition,
not placement scaling or renderer work. State-only rows intentionally leave
ordinary renderer synchronization open; the sparse-highlight row covers
renderer CPU encoding/diff and fake queue writes only. Real queue completion,
upload, draw, and first/steady-frame evidence remain open for all rows on the
real-WebGPU lane.

## Changelog

Keep one row per intentional milestone and never fill a row with an estimated
number.

| Date       | Git SHA    | Machine / Node         | Matrix                                                                 | p50 / p95 summary                                                                                                                                                           | Notes                                                                                                                                                                                                                     |
| ---------- | ---------- | ---------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-08-17 | `e8f462b1` | Apple M3 Pro / 24.18.0 | Before identity diff fix                                               | Hover 15.213 / 18.288 ms                                                                                                                                                    | `14-local-operations-before-identity-fix`                                                                                                                                                                                 |
| 2026-08-17 | `e8f462b1` | Apple M3 Pro / 24.18.0 | After identity diff fix                                                | Hover 0.008 / 0.029 ms                                                                                                                                                      | `15-local-operations-after-identity-fix`                                                                                                                                                                                  |
| 2026-08-17 | `e8f462b1` | Apple M3 Pro / 24.18.0 | Before dense result path                                               | 1M map 104.614 / 149.168 ms                                                                                                                                                 | `16-local-operations-before-elemental-dense`                                                                                                                                                                              |
| 2026-08-17 | `e8f462b1` | Apple M3 Pro / 24.18.0 | Dense result path (historical tiered report)                           | Snapshots 1/8/64: 1.150667 / 1.627625, 0.569625 / 0.603125, 0.566500 / 0.589209 ms; active CPU transitions 0.002000 / 0.004125, 0.001417 / 0.002209, 0.001416 / 0.002292 ms | CPU only; WebGPU not measured. `18-local-operations-elemental-dense-with-snapshot`                                                                                                                                        |
| 2026-08-17 | `e8f462b1` | Apple M3 Pro / 24.18.0 | Truthful CPU operation matrix (schema 2, 11 operations)                | Snapshots 1/8/64: 1.065583 / 1.906791, 0.588375 / 0.675708, 0.550125 / 0.598042 ms; one CPU hover: 0.002041 / 0.004417 ms                                                   | CPU only; WebGPU not measured. `19-local-operations-truthful-workloads.json`; tracked worktree dirty.                                                                                                                     |
| 2026-08-17 | `d969ef1a` | Apple M3 Pro / 24.18.0 | Before in-place sparse highlight update (high-water, one-record hover) | **25.650500 / 27.539708 ms**                                                                                                                                                | CPU/fake-GPU seam; 1 active record, 131,712 high-water records, 2,097,152 retained sparse slots. Setup is outside timing. `20-local-operations-before-highlight-inplace.json`.                                            |
| 2026-08-17 | `d969ef1a` | Apple M3 Pro / 24.18.0 | After in-place sparse highlight update (high-water, one-record hover)  | **0.009750 / 0.022292 ms**                                                                                                                                                  | CPU/fake-GPU seam; one active record per invocation, with 131,712 high-water records and 2,097,152 retained slots; real GPU submission/upload/draw/frame remain open. `21-local-operations-after-highlight-inplace.json`. |

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
