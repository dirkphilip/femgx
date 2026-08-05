# Browser/GPU compatibility matrix

WebGPU is the product's only rendering backend (see
[[requirements/product-scope|product scope contract]]), so the compatibility
contract is single-tier: a modern browser with a working WebGPU device.

## Capability tiers

| Tier | Runtime                        | Renderer         | Example environments                        | Coverage                                                                |
| ---- | ------------------------------ | ---------------- | ------------------------------------------- | ----------------------------------------------------------------------- |
| 1    | Chromium/Chrome with WebGPU    | WebGPU instanced | Local system Chrome (`npm run test:e2e`)    | Full pick/pixel/interaction lane (hardware WebGPU)                      |
| 1b   | Future GPU CI runner           | WebGPU instanced | Self-hosted / cloud GPU                     | Same as tier 1, in merge or nightly CI when available                   |
| 2    | Any browser, interaction smoke | WebGPU           | Opt-in perf runs                            | Opt-in `perf.yml` lane (`RUN_PERF=1`)                                   |
| —    | No `navigator.gpu`             | unsupported      | CI `npm run test:e2e:ci`, locked-down hosts | Typed unsupported contract only (not a SwiftShader full-suite stand-in) |

There is deliberately no CPU rendering tier and no SwiftShader-as-product-lane:
environments without a working WebGPU path get the explicit unsupported
behavior documented in [[rendering/platform-support|Platform support]]. The
results workbench in the demo may draw a small scalar-field view through a 2D
canvas, but that is results visualization, not a model-renderer fallback.

## What each tier guarantees

- **Tier 1** is the baseline: full scene, interaction (hover/selection),
  picking, visibility, results, and deformation on hardware WebGPU. Run it
  locally with `npm run test:e2e`. On an environment that genuinely cannot
  initialize WebGPU the demo reports its unsupported state and WebGPU
  product-contract tests skip with a reason (see
  [[engineering/e2e-policy|E2E test classification and skip policy]]).
- **Tier 1b** is the same suite on a GPU CI runner (planned); until then merge
  CI only asserts the no-GPU unsupported contract.
- **Tier 2** is a loose interaction smoke with a generous ceiling; it is a
  regression signal, not a frame-time benchmark.

Related: [[rendering/webgpu-e2e|WebGPU browser e2e lane]],
[[rendering/platform-support|Platform support]],
[[engineering/quality-gate|Quality gate]].
