# E2E test classification and skip policy

The e2e suite is classified into explicit categories so a broken product path
can never hide behind a green run. The category decides what may skip, how it
skips, and whether the skip is visible in CI. The product contract is
WebGPU-only ([[requirements/product-scope|product scope]]).

Browser ownership is explicit: `e2e/core/` contains direct public-library
browser contracts, `e2e/demo/` contains workbench UI and host-policy contracts,
and `e2e/shared/` contains owner-neutral mechanics only. No browser spec lives
directly under `e2e/`. The fast CPU lane is the exclude-based `npm run
test:core`; it does not start a browser, demo host, Svelte environment, or
WebGPU test surface.

## Categories

1. **Required product behavior** — the direct public-library foundation journeys
   in `e2e/core/core-foundation.spec.ts` and the workbench journeys under
   `e2e/demo/`, exercised by the local `chrome` project (`npm run test:e2e`,
   system Chrome / hardware WebGPU). These MUST fail when the feature is
   unavailable and never call `test.skip` unless the environment genuinely
   cannot initialize WebGPU.
2. **Environment capability coverage** — WebGPU-specific workbench
   product-contract tests under `e2e/demo/` on the same Chrome lane. These may
   skip only when the environment genuinely cannot initialize WebGPU and the
   demo reports `data-renderer="unsupported"`. Every skip carries an explicit
   reason.
3. **Optional performance/experimental coverage** — `e2e/demo/perf.spec.ts`,
   opt-in via `RUN_PERF=1`. Excluded from the default correctness gate by
   design, never run by default CI.
4. **CI no-GPU smoke** — `npm run test:e2e:no-gpu` (aliased by
   `npm run test:e2e:ci`) runs only the typed unsupported-contract journey in
   `e2e/core/core-foundation.spec.ts` on the runner's installed branded Google
   Chrome through the dedicated `chrome-unsupported` project. The workflow
   verifies the executable and version before starting Playwright, and does not
   download a Playwright browser. Full pick/pixel e2e is not asserted in merge
   CI until a GPU runner exists; SwiftShader is not used as a faithful
   stand-in.
5. **Manual software-WebGPU exploration** — the opt-in
   `e2e-exploratory.yml` workflow runs the bounded smoke plus parallel,
   one-worker SwiftShader suites. The interaction suite covers mobile, GLB/VTK,
   and runtime-error journeys; the rendering suite is split into three isolated
   shards covering results, visibility, and rendered-pixel contracts. No retries
   are used, so runtime and flake signals stay visible. It is exploratory
   evidence, not a merge gate or a substitute for the supported hardware lane.

## Why the Chrome lane must assert, not skip

The local `chrome` project uses headless system Chrome with `--enable-gpu`,
removes Playwright's unsafe SwiftShader fallback, and asserts that the resolved
adapter is neither a fallback nor SwiftShader. The demo therefore commits to
hardware WebGPU without opening a visible window. Picking is asynchronous GPU
readback through `FemViewport.pick`.
`requireHit` first uses the existing `pickRegion` seam to recursively localize
a matching identity, then verifies the returned coordinate through a real
pointer move and the normal dataset readback. Its bounded fallback grid is
capped at 100 probes, and it fails when no target is found. GPU pick readback
is a required product contract on this lane, so an automation failure is not
reported as a green capability skip. Merge CI does not run the full Chrome
lane until a GPU runner exists (`npm run test:e2e:no-gpu` covers the unsupported
contract only).

## Remaining conditional skips (audit)

The only `test.skip` calls left are WebGPU-initialization or opt-in gates:

- `e2e/demo/perf.spec.ts` — benchmark cases and their browser-only dependency graph
  are collected only with `RUN_PERF=1` (category 3; the fixed-resolution
  capacity benchmark runs only through the local system-Chrome command; see
  [[engineering/benchmarks|Benchmarks]]).
- `e2e/demo/webgpu-lifecycle.spec.ts` and the partitioned demo suites — per-test:
  "WebGPU renderer unavailable in this browser environment" (category 2;
  genuine environment capability gates when the demo reports its unsupported
  state).

No default-lane test skips on picking, selection, visibility, or inspection when
WebGPU is available.

## Making skips visible

`e2e/shared/skip-summary-reporter.ts` (wired in `playwright.config.ts`) prints a
per-reason skip count at the end of every run, so CI output surfaces how many
tests were skipped and why. The built-in `list` reporter already marks each
skipped test with `-`; the summary groups the reasons so a silent pass can
never be mistaken for a clean required-journey run.

## Required journeys

The large browser surfaces are partitioned by ownership rather than by runner:

- `e2e/demo/demo-lifecycle.spec.ts` — startup, model selection, layout, diagnostics,
  camera-control labels, and box-selection DOM behavior.
- `e2e/demo/demo-results.spec.ts` — results states, deformed picking, and fit/reset state
  preservation.
- `e2e/demo/demo-visibility.spec.ts` — hierarchy, body/part/instance visibility, and
  target/view context-menu semantics.
- `e2e/demo/demo-interaction.spec.ts` — selection, inspection, edge controls, and
  selection persistence through gestures.
- `e2e/demo/webgpu-lifecycle.spec.ts` — renderer startup, GPU interaction seams,
  teardown/recreation, and unsupported WebGPU behavior.
- `e2e/demo/webgpu-rendering.spec.ts` — rendered pixels, overlays, node/face behavior,
  transparency, and selection appearance.
- `e2e/demo/webgpu-camera.spec.ts` — camera fitting, orbit/pan/zoom, orientation gizmo,
  and clip/depth invariants.
- `e2e/demo/webgpu-visibility.spec.ts` — body visibility and visible-interface picking.

- `e2e/core/core-foundation.spec.ts` and `e2e/core/core-journeys.spec.ts` — eight
  direct public-entry journeys covering foundation lifecycle/unsupported state,
  instancing, raster picking, overlays, results, camera, and transparency. Their
  HTML host imports only `src/index.ts`; it does not mount the workbench or use
  demo selectors.

Shared support modules contain only reusable browser mechanics; they do not own
additional product journeys. A DOM semantic contract is not repeated in a GPU
suite merely because both use system Chrome.

At least one required journey covers each interactive concern, all in
the partitioned demo suites above (plus mobile coverage in
`e2e/demo/mobile.spec.ts` and `e2e/demo/mobile-touch.spec.ts`):

- **picking** — "picks and selects a node", "picks and selects a face";
- **selection state** — "selects an element by promoting a node pick with
  shift-click", "clears selection on empty scene clicks but preserves it
  through repeated orbit";
- **visibility changes** — "toggles part visibility and restores it", "context
  menu hides and restores a part";
- **inspection** — "picks and selects a node, exposing adjacency and
  neighbors" (inspection panel), "picks and selects a face".

## Browser-only routing table

The direct-core matrix is intentionally small. Existing root-level browser
titles route as follows; #869 uses this table when pruning duplicated demo
assertions.

| Existing contract                                                                                                                                                           | Owner and reason                                                                             |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Hardware adapter, instanced presentation, direct viewport teardown, public camera transitions                                                                               | `e2e/core`: public `FemViewport` lifecycle and GPU submission seams                          |
| Point/region/edge picking, visibility mutation, interaction emphasis, background/overlay resources, resize/DPR, transparency, scalar results, deformation, section clipping | `e2e/core`: raster or public-API evidence unavailable to fast tests                          |
| Workbench model choice, hierarchy/tree policy, menus, diagnostics, file import/error presentation, focus and exposed-canvas layout                                          | `e2e/demo`: Svelte/workbench host behavior                                                   |
| Mobile overflow, reachable controls, context menus, view-cube semantics, and the representative nonblank smoke path                                                         | `e2e/demo`: responsive UI and host policy; touch/pick correctness belongs to the core matrix |
| SwiftShader startup/pick and timed GPU/resource cases                                                                                                                       | `e2e/demo` software or performance projects: exploratory lanes, never hardware authority     |
| Pure camera math, result mapping, validation, layout arithmetic, cost/resource accounting, and state transitions                                                            | Fast Vitest suites: no browser journey unless a raster/DOM seam is uniquely covered          |

## Runtime-error smoke contract

`e2e/demo/smoke.spec.ts` is a required category-1 contract that closes the gap
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
