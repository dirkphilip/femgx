# Quality gate

CI (`.github/workflows/ci.yml`) enforces the full gate on every push/PR and is
the authoritative merge gate. Supervisor implementation, review, and repair
workers run focused checks once, before handoff, and do not repeat the full
gate; the reviewer records local validation but is not a merge authority (see
[[operations/ci-authority|CI authority and base-health intake]] and
[[operations/supervisor-workflow|Supervisor workflow]]). Pre-commit framework
hooks ([[engineering/pre-commit-hooks|Pre-commit hooks]]) run via CI in
addition to the npm gate.

## Local gate

```sh
npm run format
npm run typecheck
npm run lint
npm run test:coverage
npm run bench:budget
npm run test:e2e          # system Chrome / hardware WebGPU (local)
```

`npm run bench:budget` runs the performance budget gate standalone (see
[[engineering/benchmarks|Benchmarks]]) because v8 coverage instrumentation distorts wall
clock timing; CI runs it as its own step. `npm run bench` is the opt-in trend
suite, not part of the gate. Merge CI runs `npm run test:e2e:ci` (no-GPU
unsupported contract only) until a GPU runner hosts the full Chrome lane.

## Coverage

- v8 provider, thresholds enforced: lines/functions 80%, branches 70%.
- Reporters `text`/`html`/`lcov` write to `coverage/`; CI uploads it as an
  artifact.
- Missing coverage is a dead-code audit lead, not a reason to pad tests.
- `test/gpu-renderer.test.ts` uses a mocked WebGPU device to exercise adapter
  failure, resource upload/reuse, render passes, pick readback, resize, and teardown.

## Playwright e2e

- `e2e/` tests run against the local Vite dev server (see
  `playwright.config.ts`, `webServer`).
- One-time browser install: `npm run test:e2e:install` (system Chrome + Chromium).
- **Local / authoritative WebGPU lane:** `npm run test:e2e` (`--project=chrome`).
- **Merge CI:** `npm run test:e2e:ci` (unsupported-contract smoke only).
- See [[rendering/webgpu-e2e|WebGPU browser e2e lane]] and
  [[engineering/e2e-policy|E2E test classification and skip policy]].

## Protected main

The `main` branch requires the two stable CI contexts `check` and `e2e`.
`check` contains pre-commit validation, formatting, strict type checking,
linting, coverage-enforced unit tests, the performance budget, the library
build, and package smoke tests. `e2e` is the required no-GPU unsupported
contract lane in hosted CI; the real system-Chrome WebGPU lane remains the
required local validation for rendering, camera, interaction, demo, and
responsive-layout changes because hosted runners do not provide deterministic
hardware WebGPU.

Both contexts must be successful and present before a pull request can merge;
an optional performance experiment never substitutes for either context.
Administrators are subject to the same requirement, and force-push/deletion of
`main` is disabled. A red `main` pauses feature intake: repair the failing
base first, then re-run the full gate before starting new work.

## Linting (small modules)

ESLint caps source files at 400 implementation lines. Around 300 lines is a
design-review threshold, not an automatic split requirement. Per-function
length remains 60 lines and `max-depth` remains 4. Split modules when that
improves cohesion and ownership. Rules are scoped to `src/`; tests and demo are exempt. See the
[[engineering/scaffold-decisions|scaffold decisions]] gotchas for why.
