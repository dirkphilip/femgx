# E2E test classification and skip policy

The e2e suite is classified into explicit categories so a broken product path
can never hide behind a green run. The category decides what may skip, how it
skips, and whether the skip is visible in CI. The product contract is
WebGPU-only ([[requirements/product-scope|product scope]]).

## Categories

1. **Required product behavior** — the core WebGPU journeys (render, selection,
   picking, visibility, inspection) exercised by the default `chromium` lane.
   These MUST fail when the feature is unavailable and never call `test.skip`
   unless the environment genuinely cannot initialize WebGPU.
2. **Environment capability coverage** — WebGPU-specific product-contract tests
   (`e2e/webgpu.spec.ts`) in the same default lane. These may skip only when
   the environment genuinely lacks the capability (the demo reported
   `data-renderer="unsupported"`, or GPU picking did not resolve). Every skip
   carries an explicit reason.
3. **Optional performance/experimental coverage** — `e2e/perf.spec.ts`,
   opt-in via `RUN_PERF=1`. Excluded from the default correctness gate by
   design, never run by default CI.

## Why the default WebGPU lane must assert, not skip

The default `chromium` project launches with software WebGPU enabled, so the
demo deterministically commits to the WebGPU renderer. Picking is unified CPU
raycasting (`demo/controller.ts`, `demo/pick.ts`), so node/face/element picking
resolves deterministically on this lane. A pick sweep that finds no target is
therefore a broken picking path, not a missing capability: `e2e/helpers.ts`
exposes `requireHit`, which fails the test loudly instead of skipping.

Requiring the WebGPU renderer on the default lane (see the depth-test and
context-menu tests in `e2e/demo.spec.ts` and `e2e/webgpu.spec.ts`) means a
browser that cannot initialize WebGPU fails those required assertions instead of
silently skipping its WebGPU contract. Only the capability-gated product tests
may skip, and only on a genuine `data-renderer="unsupported"` report.

## Remaining conditional skips (audit)

The only `test.skip` calls left are capability or opt-in gates:

- `e2e/perf.spec.ts` — file-level: "browser performance runs are opt-in via
  RUN_PERF=1" (category 3; runs only under `perf.yml`).
- `e2e/webgpu.spec.ts`, `e2e/visual.spec.ts`, `e2e/demo.spec.ts` — per-test:
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
