# Quality gate

The reviewer runs the full gate once before submission; CI
(`.github/workflows/ci.yml`) enforces the same gate on every push/PR.
Supervisor implementation and repair workers use focused checks and do not
repeat the full gate. See [[operations/supervisor-workflow|Supervisor workflow]].

## Local gate

```sh
npm run format
npm run typecheck
npm run lint
npm run test:coverage
npm run bench:budget
npm run test:e2e
```

`npm run bench:budget` runs the performance budget gate standalone (see
[[engineering/benchmarks|Benchmarks]]) because v8 coverage instrumentation distorts wall
clock timing; CI runs it as its own step. `npm run bench` is the opt-in trend
suite, not part of the gate.

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
- One-time browser install: `npm run test:e2e:install` (Chromium).
- `e2e/demo.spec.ts` verifies the demo canvas renders instanced geometry.
- CI installs with `--with-deps` and uploads the report on failure.
- The default lane is deterministic and exercises the CPU fallback only. An
  opt-in WebGPU-capable lane (`RUN_WEBGPU=1`, `.github/workflows/webgpu.yml`)
  exercises the real WebGPU path through the demo and skips cleanly when the
  browser cannot present/pick (see [[rendering/webgpu-e2e|WebGPU browser e2e lane]]).

## Linting (small modules)

ESLint caps source files: `max-lines` 300, per-function 60, `max-depth` 4.
Rules are scoped to `src/`; tests and demo are exempt. See the
[[engineering/scaffold-decisions|scaffold decisions]] gotchas for why.
