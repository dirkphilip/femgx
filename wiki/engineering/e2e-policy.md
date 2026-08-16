# E2E test classification and skip policy

The e2e suite is classified into explicit categories so a broken product path
can never hide behind a green run. The category decides what may skip, how it
skips, and whether the skip is visible in CI. The product contract is
WebGPU-only ([[requirements/product-scope|product scope]]).

Browser ownership is explicit: `e2e/core/` contains direct public-library
browser contracts, `e2e/demo/` contains workbench UI and host-policy contracts,
and `e2e/browser-support/` contains owner-neutral mechanics only. No browser spec lives
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
   `e2e-exploratory.yml` workflow runs
   `npx playwright test --project=chrome-software --project=chrome-software-interaction --reporter=list,html`
   through one-worker SwiftShader projects. `chrome-software` covers the
   software-WebGPU spec; `chrome-software-interaction` covers demo import,
   mobile, and smoke journeys. No retries are used, so runtime and flake
   signals stay visible. It is exploratory evidence, not a merge gate or a
   substitute for the supported hardware lane.

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
- the supported WebGPU demo suites — per-test:
  "WebGPU renderer unavailable in this browser environment" (category 2;
  genuine environment capability gates when the demo reports its unsupported
  state).

No default-lane test skips on picking, selection, visibility, or inspection when
WebGPU is available.

## Making skips visible

`e2e/browser-support/skip-summary-reporter.ts` (wired in `playwright.config.ts`) prints a
per-reason skip count at the end of every run, so CI output surfaces how many
tests were skipped and why. The built-in `list` reporter already marks each
skipped test with `-`; the summary groups the reasons so a silent pass can
never be mistaken for a clean required-journey run.

## Required journeys

The large browser surfaces are partitioned by ownership rather than by runner:

- `e2e/demo/demo-lifecycle.spec.ts` — startup, model selection, layout, diagnostics,
  view-cube semantics, and box-selection DOM behavior.
- `e2e/demo/demo-results.spec.ts` — result controls, legend presentation, and fit/reset
  command state.
- `e2e/demo/demo-visibility.spec.ts` — hierarchy, body/block/part/instance visibility,
  and target/view context-menu semantics.
- `e2e/demo/demo-interaction.spec.ts` — selection, inspection, edge controls, and
  the smallest context-menu selection routes.
- `e2e/demo/demo-import.spec.ts` — GLB/VTK file input, import errors, reset, and
  responsive source controls.
- `e2e/demo/mobile.spec.ts` — phone drawer, reachable controls, stacked viewport routing,
  overflow, context menus, and exposed-canvas layout.
- `e2e/demo/demo-layout.spec.ts` — ordinary-story nonblank smoke and desktop/compact/phone
  geometry budgets.
- `e2e/demo/smoke.spec.ts` — one representative load/render/action/runtime-error journey.
- `e2e/demo/software-webgpu.spec.ts` and `e2e/demo/perf.spec.ts` — opt-in exploratory
  software and performance owners; neither is authoritative merge coverage.

- `e2e/core/core-foundation.spec.ts` and `e2e/core/core-journeys.spec.ts` — eight
  direct public-entry journeys covering foundation lifecycle/unsupported state,
  instancing, raster picking, overlays, results, camera, and transparency. Their
  HTML host imports only the explicit `src/entries/*` facades; it does not mount
  the workbench or use demo selectors.

Shared support modules contain only reusable browser mechanics; they do not own
additional product journeys. A DOM semantic contract is not repeated in a GPU
suite merely because both use system Chrome.

At least one required journey covers each retained interactive concern in the
partitioned demo suites above (plus the mobile coverage in
`e2e/demo/mobile.spec.ts`):

- **picking and inspection routes** — node, face, and authored-edge context
  menus remain in `demo-interaction`, with adjacency and ownership assertions;
- **selection state** — granularity and through-intersection controls remain in
  `demo-interaction`, while raster selection transitions belong to `e2e/core`;
- **visibility changes** — occurrence, body, authored block, hierarchy, Show all,
  and context-menu policy remain in `demo-visibility`;
- **responsive behavior** — reachable controls, stacked viewports, menus, and
  exposed-canvas geometry remain in `mobile` and `demo-layout`.

## #869 ownership audit

The demo browser owner was pruned after the direct public-entry matrix landed
in #867. The default demo collection went from 140 tests in 13 files to 59
tests in 8 files. It still exercises desktop and 390×844 phone viewports;
unsupported WebGPU skips are reasoned by the shared demo gate, and the software
project retains only its bounded smoke, mobile, and import paths. Cold/warm
runtimes are recorded in the #869 pull request. The removed low-level journeys have
named owners:

- public lifecycle, instancing, raster point/region/edge picking, visibility,
  presentation, results, section clipping, camera transitions, and transparency
  are owned by `e2e/core/core-foundation.spec.ts` and
  `e2e/core/core-journeys.spec.ts`;
- camera math, gesture invariants, DPR sizing, and pick encoding remain in the
  fast camera/interaction/renderer suites, with the demo retaining only
  view-cube semantics and responsive routing;
- rendered-pixel, overlay, node, transparency, and resource assertions are
  renderer/core contracts, not duplicate workbench journeys;
- benchmark models, repeated box stress, continuous rendering, and timed
  readbacks belong to `e2e/demo/perf.spec.ts` or the software exploratory lane;
- demo-specific behavior retained in `e2e/demo` is semantic DOM/state: model
  choice, hierarchy and visibility policy, menus, diagnostics, import/error
  presentation, focus, responsive geometry, and the representative smoke path.

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
