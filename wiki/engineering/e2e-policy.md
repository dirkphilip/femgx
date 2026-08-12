# E2E test classification and skip policy

The e2e suite is classified into explicit categories so a broken product path
can never hide behind a green run. The category decides what may skip, how it
skips, and whether the skip is visible in CI. The product contract is
WebGPU-only ([[requirements/product-scope|product scope]]).

## Categories

1. **Required product behavior** — the core WebGPU journeys (render, selection,
   picking, visibility, inspection) exercised by the local `chrome` project
   (`npm run test:e2e`, system Chrome / hardware WebGPU). These MUST fail when
   the feature is unavailable and never call `test.skip` unless the environment
   genuinely cannot initialize WebGPU.
2. **Environment capability coverage** — WebGPU-specific product-contract tests
   (`e2e/webgpu.spec.ts`) on the same Chrome lane. These may skip only when the
   environment genuinely lacks the capability (the demo reported
   `data-renderer="unsupported"`, or GPU picking did not resolve). Every skip
   carries an explicit reason.
3. **Optional performance/experimental coverage** — `e2e/perf.spec.ts`,
   opt-in via `RUN_PERF=1`. Excluded from the default correctness gate by
   design, never run by default CI.
4. **CI no-GPU smoke** — `npm run test:e2e:ci` runs only the unsupported-contract
   test on Playwright Chromium. Full pick/pixel e2e is not asserted in merge CI
   until a GPU runner exists; SwiftShader is not used as a faithful stand-in.

## Why the Chrome lane must assert, not skip

The local `chrome` project uses headed system Chrome so the demo commits to
hardware WebGPU. Picking is asynchronous GPU readback through
`FemViewport.pick`.
`requireHit` skips when a sweep finds no target — Playwright automation can
still fail to complete pick readback even on a healthy GPU — and merge CI does
not run the full Chrome lane until a GPU runner exists (`npm run test:e2e:ci`
covers the unsupported contract only).

## Remaining conditional skips (audit)

The only `test.skip` calls left are capability or opt-in gates:

- `e2e/perf.spec.ts` — file-level: "browser performance runs are opt-in via
  RUN_PERF=1" (category 3; the fixed-resolution capacity benchmark runs only
  under `perf.yml`; see [[engineering/benchmarks|Benchmarks]]).
- `e2e/webgpu.spec.ts`, `e2e/demo.spec.ts` — per-test:
  "WebGPU renderer unavailable in this browser environment" and "picking is not
  functional in this browser environment" (category 2; genuine environment
  capability gates when the demo reports its unsupported state).

No default-lane test skips on picking, selection, visibility, or inspection when
WebGPU is available.

## Making skips visible

`e2e/skip-summary-reporter.ts` (wired in `playwright.config.ts`) prints a
per-reason skip count at the end of every run, so CI output surfaces how many
tests were skipped and why. The built-in `list` reporter already marks each
skipped test with `-`; the summary groups the reasons so a silent pass can
never be mistaken for a clean required-journey run.

## Required journeys

At least one required journey covers each interactive concern, all in
`e2e/demo.spec.ts` (plus mobile coverage in `e2e/mobile.spec.ts` and
`e2e/mobile-touch.spec.ts`):

- **picking** — "picks and selects a node", "picks and selects a face";
- **selection state** — "selects an element by promoting a node pick with
  shift-click", "keeps selection stable across repeated orbit interactions";
- **visibility changes** — "toggles part visibility and restores it", "context
  menu hides and restores a part";
- **inspection** — "picks and selects a node, exposing adjacency and
  neighbors" (inspection panel), "picks and selects a face".

## Runtime-error smoke contract

`e2e/smoke.spec.ts` is a required category-1 contract that closes the gap
between "the right DOM attributes are set" and "the app actually works end to
end". It runs one deterministic vertical in the default WebGPU lane and fails
the run when any of the following is true:

- the page raises an unexpected `pageerror` (uncaught exception);
- the browser logs an unexpected console error (`console.error`);
- the demo does not commit to the WebGPU renderer and report a rendered model;
- the canvas does not actually draw geometry;
- a representative user action (pick + select a node) updates neither the
  application state nor the rendered pixels.

The contract asserts load → render → interaction → observable result with
stable semantic assertions (`expect.poll` on renderer/selection state, pixel
fingerprints on the WebGPU lane) instead of timing-based waits. Failure artifacts
come from the standard Playwright run: the CI job uploads `playwright-report`,
traces are captured on retry, and a failure screenshot is taken
(`screenshot: "only-on-failure"` in `playwright.config.ts`).

Feature-specific assertions stay in their owning suites; the smoke contract
only pins the vertical and the runtime-error surface, so a partially broken app
(an exception mid-frame, a swallowed console error, state updated without a
visible redraw) can no longer pass a green required run.

Related: [[engineering/quality-gate|Quality gate]], [[rendering/webgpu-e2e|WebGPU browser e2e lane]].

[engineering/benchmarks|Benchmarks]: benchmarks.md
[engineering/quality-gate|Quality gate]: quality-gate.md
[rendering/webgpu-e2e|WebGPU browser e2e lane]: ../rendering/webgpu-e2e.md
[requirements/product-scope|product scope]: ../requirements/product-scope.md
