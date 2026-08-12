# Benchmarks and performance budgets

Deterministic performance validation for the CPU-side scene pipeline. See
[[engineering/quality-gate|Quality gate]] for how budgets fit into CI and
[[engineering/performance-issues|Performance issues]] for known renderer/GPU gaps.

## Budget gate (runs in default CI)

`npm run bench:budget` runs `test/bench/budget.test.ts` and fails if any
measured workload exceeds its documented ceiling. It is a dedicated CI step in
`.github/workflows/ci.yml` and is deliberately **not** part of
`npm run test:coverage`: v8 coverage instrumentation slows execution by
several multiples, so budgets are only meaningful on clean timing runs.

### Covered workloads

| Case                        | Model                            | Workload                                 |
| --------------------------- | -------------------------------- | ---------------------------------------- |
| `createSceneRuntime`        | shallow 200 000 instances        | packed compile                           |
| `createSceneRuntime` (deep) | balanced tree, 204 800 instances | nested transform composition             |
| `setPartVisible` toggle     | part with 1 000 instances        | hide then show                           |
| `setAssemblyVisible` toggle | subcase with 2 000 instances     | hide then show                           |
| `setInstanceVisible` toggle | single instance                  | override, hide then show                 |
| `setNodeTransform`          | 2 000-instance subtree           | recompose subtree worlds                 |
| `getDrawList`               | 200 000 visible                  | rebuild draw list                        |
| `resolvePick`               | 50 000 lookups on 200 000        | O(1) index resolution                    |
| `heterogeneousElementParts` | 600 mixed linear elements        | grouped triangle/line/point tessellation |

### Stable model sizes and warmup rules

- Models are generated deterministically in `test/bench/fixtures.ts` with the
  sizes above; the scenes are constructed directly (not via `SceneBuilder`,
  whose immutable copies are intentionally quadratic for authoring convenience).
- `test/bench/measure.ts` defines the timing rules: **2 untimed warmup runs**,
  **7 timed samples**, **median** reported in milliseconds per iteration.
- Mutating workloads (visibility/transform updates) are written as toggles that
  restore state, so every sample does the same amount of work instead of
  short-circuiting on a second no-op call.

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

## Benchmark suite (opt-in, trend tracking)

`npm run bench` runs the Vitest `bench` suite in `test/bench/cpu.bench.ts` over
the same models plus a few extra update cases. It reports ops/sec / time per
case for human review and trend comparison and is **not** part of the default
gate. The opt-in `.github/workflows/perf.yml` (`workflow_dispatch`) runs the CPU
suite on GitHub-hosted infrastructure. It does not claim real-WebGPU
measurements.

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
high-performance WebGPU adapter, performs two untimed warmups, and reports p50
and p95 from seven timed samples. Set `RUN_PERF_LARGE=1` to include the bounded
2-million-unique-triangle local case in addition to the default cases:

| Case              | Unique triangles | Instances | Submitted triangles |
| ----------------- | ---------------: | --------: | ------------------: |
| `instanced-2.10m` |           32,768 |        64 |           2,097,152 |
| `unique-250k`     |          250,632 |         1 |             250,632 |
| `unique-1m`       |          999,698 |         1 |             999,698 |
| `unique-2m-local` |        2,000,000 |         1 |           2,000,000 |

Each iteration creates a fresh renderer over the same deterministic scene. It
drains `GPUQueue.onSubmittedWorkDone()` around the initial upload/first frame
and steady visible frame. The upload/attachment estimate is their difference.
After priming reusable pick targets and applying a camera-reference
invalidation, it measures the combined lazy pick snapshot plus readback and then
a cached-snapshot readback; the pick-snapshot estimate is their difference. The
report retains both directly measured totals alongside the estimates. Portable
WebGPU timestamp queries are not required.

The JSON report identifies the browser user agent, adapter identity and fallback
status, enabled features, resolution, DPR, triangle counts, timings, and an
estimated GPU-buffer/render-target memory breakdown. Playwright writes it as
`webgpu-benchmark.json` in the local test output. Compare reports only between
similar browser/adapter configurations; the numbers are a capacity envelope,
not a universal triangle limit. GitHub-hosted Actions does not run this browser
benchmark until an explicitly owned real-GPU runner exists.

## Interactive WebGPU inspection case

The full-screen demo includes a deliberately demo-owned `Performance · 2.10M
triangles` model. `demo/fixture/performance-fixture.ts` generates one 128 × 128 shell
and places it 64 times, exercising reusable geometry and GPU instancing at
exactly 2,097,152 triangles without a second renderer or a checked-in mesh
asset. The demo is idle by default and renders only after viewport invalidation.
Its overlay distinguishes the 32,768 unique triangles from 2,097,152 submitted
triangles, reports the actual rendered-frame count, and clearly marks the idle
state. Selecting this performance preset runs one bounded 500 ms FPS sample,
reports the result, and then returns to idle. It remains a manual visual check;
the opt-in benchmark above owns reproducible cost breakdowns.

[engineering/performance-issues|Performance issues]: performance-issues.md
[engineering/quality-gate|Quality gate]: quality-gate.md
