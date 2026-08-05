# Browser/GPU compatibility matrix

WebGPU is the product's only rendering backend, so the compatibility contract is
single-tier: the e2e lane exercises the real WebGPU path in Chromium using
software rendering (SwiftShader), so no GPU hardware is required on CI.

## Capability tiers

| Tier | Runtime                                        | Renderer         | Example environments                          | CI coverage                                                     |
| ---- | ---------------------------------------------- | ---------------- | --------------------------------------------- | --------------------------------------------------------------- |
| 1    | Chromium with WebGPU (hardware or SwiftShader) | WebGPU instanced | Chrome/Edge, CI with `--enable-unsafe-webgpu` | Default `ci.yml` e2e lane (`chromium` project, software WebGPU) |
| 2    | Any browser, interaction smoke                 | WebGPU           | Local dev, opt-in perf runs                   | Opt-in `perf.yml` lane (`RUN_PERF=1`)                           |

There is deliberately no CPU rendering tier: environments without a working
WebGPU path get the explicit unsupported behavior documented in
[[rendering/platform-support|Platform support]]. The results workbench in the
demo draws its small scalar-field view through a 2D canvas, but that is a
CPU-side results visualization, not a rendering fallback for the model.

## What each tier guarantees

- **Tier 1** is the baseline: full scene, interaction (hover/selection),
  picking, visibility, results, and deformation on the real WebGPU renderer.
  This is the only tier the default CI gate requires. On an environment that
  genuinely cannot initialize WebGPU the demo reports its unsupported state and
  the WebGPU product-contract tests skip with a reason (see
  [[engineering/e2e-policy|E2E test classification and skip policy]]).
- **Tier 2** is a loose interaction smoke with a generous ceiling; it is a
  regression signal, not a frame-time benchmark.

## Element and rendering-mode coverage

The visual regression lane (`e2e/visual.spec.ts`) pins the WebGPU pixel output
for the **solid**, **edge**, and **selection** display modes via settled,
byte-identical screenshot comparisons. The element-family render modes
(**solid**, **surface**, **edges**, **lines**, **points**) switch visible
families as part-visibility deltas. Switching **solid**/**surface**/**edges** is
covered by the demo's element-mode e2e tests (`e2e/demo.spec.ts`); the
**points** and **lines** parts render as always-visible overlays in every demo
and visual test, and the point/line topology those modes draw is pinned by the
golden fixtures in `test/elements/golden.ts` (see
[[data/elements-topology|Element topology]] and [[rendering/element-rendering|Element
rendering]]).

Related: [[engineering/quality-gate|Quality gate]],
[[rendering/webgpu-e2e|WebGPU browser e2e lane]],
[[rendering/pick-format|Pick texture format]].
