# Benchmarks and performance budgets

Deterministic performance validation for the CPU-side scene pipeline. See
[[quality-gate|Quality gate]] for how budgets fit into CI and
[[performance-issues|Performance issues]] for known renderer/GPU gaps.

## Budget gate (runs in default CI)

`npm run bench:budget` runs `test/bench/budget.test.ts` and fails if any
measured workload exceeds its documented ceiling. It is a dedicated CI step in
`.github/workflows/ci.yml` and is deliberately **not** part of
`npm run test:coverage`: v8 coverage instrumentation slows execution by
several multiples, so budgets are only meaningful on clean timing runs.

### Covered workloads

| Case                                | Model                            | Workload                     |
| ----------------------------------- | -------------------------------- | ---------------------------- |
| `flattenAssembly`                   | shallow 200 000 instances        | full depth-first flatten     |
| `compileScene`                      | shallow 200 000 instances        | flatten + batch              |
| `compileScene` with culling         | shallow 200 000 instances        | flatten + cull + batch       |
| `createSceneRuntime`                | shallow 200 000 instances        | packed compile               |
| `createSceneRuntime` (deep)         | balanced tree, 204 800 instances | nested transform composition |
| `batchInstancesByPart`              | 200 000 instances / 200 parts    | group by part                |
| `cullInstances`                     | 200 000 instances                | sphere-in-frustum test       |
| `setPartVisible` toggle             | part with 1 000 instances        | hide then show               |
| `setAssemblyVisible` toggle         | subcase with 2 000 instances     | hide then show               |
| `setInstanceVisible` toggle         | single instance                  | override, hide then show     |
| `setNodeTransform`                  | 2 000-instance subtree           | recompose subtree worlds     |
| `getDrawList`                       | 200 000 visible                  | rebuild draw list            |
| `resolvePick`                       | 50 000 lookups on 200 000        | O(1) index resolution        |
| `parseChunk`                        | 500 chunks / 3 000 000 vertices  | validate + bound + rebase    |
| `buildSpatialGrid`                  | 500 chunks                       | uniform-grid partition       |
| `cullChunks`                        | 500 chunks against one frustum   | cell-then-chunk culling      |
| `createChunkStream`                 | 500 chunks / 3 000 000 vertices  | deterministic budgeted load  |
| `progressive renderer attach delta` | 200 000 instances + 10 subcases  | layout + growth delta        |

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
gate. The opt-in `.github/workflows/perf.yml` (`workflow_dispatch`) runs it and
the browser performance smoke on demand.

## Browser performance (opt-in)

`e2e/perf.spec.ts` measures the demo's interaction round trip in Chromium. It
is skipped by default and runs only with `RUN_PERF=1` (set by `perf.yml`). True
WebGPU frame-time benchmarking needs a WebGPU-capable runner and is future work
(see [[performance-issues|Performance issues]]).

Related: [[todo|Engineering TODO]].
