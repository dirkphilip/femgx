# Test strategy and audit

This note records the August 2026 audit for issue #236. The unit suite on the
audit base contained 68 test files and 733 passing tests; coverage thresholds
remain 80% for lines, functions, and statements and 70% for branches. The
performance budget is measured separately without coverage instrumentation.

## Retained contract coverage

| Area                        | Primary tests                                            | Classification                                                                     |
| --------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Math, camera, controls      | `test/math`, `test/camera`, `test/demo/camera-*`         | Contract and regression protection                                                 |
| Elements and topology       | `test/elements`                                          | Canonical ordering, validation, faces, edges, and golden fixtures                  |
| Geometry and results        | `test/geometry`, `test/results`                          | Tessellation, metadata, authored scalar mapping, and nodal deformation             |
| Scene and runtime           | `test/scene`, `test/scene-runtime`, `test/runtime`       | Hierarchy validation, packed state, culling, batching, and stress budgets          |
| Interaction and picking     | `test/interaction`, `test/picking`                       | Immutable state, precedence, adjacency, and GPU-id resolution                      |
| Renderer and platform       | `test/renderer`, `test/platform`                         | Fake-device lifecycle, buffer writes, shaders, picking, and unsupported paths      |
| IO                          | `test/io`                                                | VTK round trips, diagnostics, validation, and malformed input                      |
| Viewport and public API     | `test/viewport`, `test/public-api`                       | Canonical facade workflow and deliberate root exports                              |
| Demo fixtures and workbench | `test/demo`                                              | Fixture construction, controls, lifecycle, and preset behavior                     |
| Engineering safeguards      | `test/scripts`, `test/bench`                             | Repository policy and deterministic CPU budgets                                    |
| Browser product contract    | `e2e/smoke`, `e2e/demo-*`, `e2e/webgpu-*`, `e2e/mobile*` | WebGPU rendering, picking, interaction, responsive behavior, and unsupported state |

The `chrome` project is the real-WebGPU visual and interaction lane. The
Chromium CI lane runs only the explicit unsupported-contract test; it does not
pretend that SwiftShader is product evidence. `e2e/perf.spec.ts` is opt-in and
does not gate correctness.

## Audit decisions

- Removed `e2e/visual.spec.ts`. Its three settled-pixel assertions duplicated
  the required WebGPU rendering suite, so they now live in
  `e2e/webgpu-rendering.spec.ts` beside the renderer contract and share one
  capability gate.
- Removed a stale `results.spec.ts` reference from the smoke-suite comment;
  static results coverage is owned by `test/results`, viewport tests, and
  `e2e/demo-results.spec.ts`.
- No test asserts the removed CPU renderer, library-owned `CasePlayer`, non-VTK
  adapters, or streaming subsystem. Mentions of those terms in policy tests and
  historical wiki notes are intentional contract/deletion checks, not obsolete
  product expectations. Host-driven authored snapshot sequencing continues to
  use the tested repeated-`setResults()` boundary.
- No coverage threshold was lowered and no retained test was deleted solely to
  improve runtime or reported coverage. New feature issues must add focused
  contract tests in the owning subsystem and update this inventory when they
  change the test surface.
- Contract and regression tests should also protect the owning boundary's
  documented invariants, including forbidden, boundary, inverse, and round-trip
  paths where applicable; see [[engineering/state-invariants|Invariant-driven
  state design]].

Related: [[engineering/e2e-policy|E2E policy]],
[[engineering/quality-gate|Quality gate]],
[[engineering/viewer-conformance-matrix|Viewer conformance matrix]], and
[[requirements/product-scope|Product scope]].

[engineering/e2e-policy|E2E policy]: e2e-policy.md
[engineering/quality-gate|Quality gate]: quality-gate.md
[engineering/state-invariants|Invariant-driven state design]: state-invariants.md
[engineering/viewer-conformance-matrix|Viewer conformance matrix]: viewer-conformance-matrix.md
[requirements/product-scope|Product scope]: ../requirements/product-scope.md
