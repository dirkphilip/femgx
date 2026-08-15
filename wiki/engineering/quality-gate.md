# Quality gate

CI (`.github/workflows/ci.yml`) enforces the full gate on every push/PR and is
the authoritative merge gate. Local checks provide fast feedback, but required
GitHub checks decide mergeability (see [[operations/ci-authority|CI
authority]]). Husky runs lint-staged followed by the staged-file pre-commit
framework check locally; CI independently runs the framework across all tracked
files in addition to the npm gate.

The pre-commit framework includes check-only codespell validation for tracked
repository text, TOML syntax validation for supervisor configuration, and the
semantic workflow checks documented in [[engineering/pre-commit-hooks|Pre-commit
hooks]].

## Local gate

```sh
npm run format
npm run typecheck
npm run lint
npm run build:docs
npm run review:diff
npm run test:coverage
npm run test:demo:coverage
npm run bench:budget
npm run test:e2e          # system Chrome / hardware WebGPU (local)
npm run test:e2e:layout   # ordinary-story desktop/mobile layout contract
```

`npm run bench:budget` runs the performance budget gate standalone (see
[[engineering/benchmarks|Benchmarks]]) because v8 coverage instrumentation distorts wall
clock timing; CI runs it as its own step. `PERF_REPORT=1 npm run bench:budget`
is the opt-in trend report, while `npm run bench` remains the local body-batch
comparison; neither is part of the merge gate. Merge CI runs `npm run test:e2e:ci` (no-GPU
unsupported contract only) until a GPU runner hosts the full Chrome lane.

`npm run lint:actionlint` is the focused semantic GitHub Actions workflow check.
The CI pre-commit step runs the same pinned checker across all tracked workflow
files; `npm run lint:actions` separately enforces the repository's full-SHA
external-action policy.

`npm run lint:dependencies` runs the production dependency-cruiser gate. It
checks cycles, root-barrel imports, renderer and geometry boundaries, and the
explicit subsystem DAG. Type-only imports are included because they still
encode ownership and can create declaration-build cycles.

`npm run build:docs` is the same TypeDoc validation command required by CI. It
cleans the ignored API output, validates links and paths, requires documentation
for selected public declaration kinds, and treats validation warnings as errors.
Internal union helpers that are intentionally absent from the package entry
facades are listed explicitly in `typedoc.json`; that exception does not weaken
public API coverage.

`npm run review:diff` is a successful, advisory review step. It reports when a
change adds or renames a production TypeScript module that takes a direct `src/`
directory above 20 modules. Existing outliers, edits, deletions, nested
directory counts, and non-production paths do not create noise. The message is
a prompt to review semantic ownership, not a requirement to split a directory.

## Coverage

- v8 provider, thresholds enforced: lines/functions 80%, branches 70%.
- Reporters `text`/`html`/`lcov` write to `coverage/`; CI uploads it as an
  artifact.
- `npm run test:demo:coverage` produces two independent reports and thresholds:
  `coverage/demo-core` covers the unit-tested plain-TypeScript workbench
  state/presentation core, while `coverage/demo-components` covers the Svelte
  presentation components through the official Svelte Vite plugin and
  `happy-dom`. Both reports enforce 80% statements/lines, 70% branches, and
  85% functions. Browser-owned bootstrap and GPU lifecycle modules remain
  outside the unit scope and are covered by the Playwright lanes below.
- Missing coverage is a dead-code audit lead, not a reason to pad tests.
- `test/renderer/gpu-renderer.test.ts` uses a mocked WebGPU device to exercise adapter
  failure, resource upload/reuse, render passes, pick readback, resize, and teardown.

## Playwright e2e

- `e2e/` tests run against the local Vite dev server (see
  `playwright.config.ts`, `webServer`).
- `npm run test:core` is the fast exclude-based library lane; it omits demo,
  renderer, viewport, platform, script, and budget suites and starts no browser
  or Svelte environment.
- One-time browser install: `npm run test:e2e:install` (Playwright Chrome for the
  local WebGPU lane).
- **Direct core browser lane:** `npm run test:e2e:core` runs the two foundation
  journeys against the lean public-entry host.
- **Workbench browser lane:** `npm run test:e2e:demo` runs the demo owner root.
- **Combined serialized hardware lane:** `npm run test:e2e` (one Chrome worker).
- **Local / authoritative layout lane:** `npm run test:e2e:layout` checks every
  ordinary story at 1440×900 and 390×844 for overflow, hidden-surface
  semantics, toolbar containment, exposed canvas height, legend placement, and
  nonblank WebGPU output.
- **Software exploration:** `npm run test:e2e:software` (SwiftShader only).
- **Performance exploration:** `npm run test:e2e:performance` (opt-in).
- **Merge CI:** `npm run test:e2e:no-gpu` (unsupported-contract smoke only;
  `test:e2e:ci` remains an alias).
- See [[rendering/webgpu-e2e|WebGPU browser e2e lane]] and
  [[engineering/e2e-policy|E2E test classification and skip policy]].

## Protected main

The `main` branch requires the two stable CI contexts `check` and `e2e`.
`check` aggregates parallel static/quality and runtime/package jobs containing
pre-commit validation, formatting, strict type checking, linting,
API documentation validation, coverage-enforced unit tests, the performance
budget, the library build, and package smoke tests. `e2e` is the required no-GPU unsupported
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
improves cohesion and ownership. Rules are scoped to `src/`; tests and demo are
exempt.

[engineering/benchmarks|Benchmarks]: benchmarks.md
[engineering/e2e-policy|E2E test classification and skip policy]: e2e-policy.md
[engineering/pre-commit-hooks|Pre-commit hooks]: pre-commit-hooks.md
[operations/ci-authority|CI authority]: ../operations/ci-authority.md
[rendering/webgpu-e2e|WebGPU browser e2e lane]: ../rendering/webgpu-e2e.md
