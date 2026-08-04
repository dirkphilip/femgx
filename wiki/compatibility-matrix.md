# Browser/GPU compatibility matrix

Documented capability tiers for the library and demo. These tiers are the
compatibility contract the CI lanes exercise: the default lane validates the
deterministic CPU fallback, and opt-in lanes exercise the real WebGPU path and
browser performance (see [[webgpu-e2e|WebGPU browser e2e lane]] and
[[benchmarks|Benchmarks]]).

## Capability tiers

| Tier | Runtime                                        | Renderer                      | Example environments                          | CI coverage                                                          |
| ---- | ---------------------------------------------- | ----------------------------- | --------------------------------------------- | -------------------------------------------------------------------- |
| 1    | Any modern browser with Canvas2D               | Deterministic CPU (2D canvas) | All browsers, headless CI                     | Default `ci.yml` e2e lane (`chromium` project, `--disable-gpu`)      |
| 2    | Chromium with WebGPU (hardware or SwiftShader) | WebGPU instanced              | Chrome/Edge, CI with `--enable-unsafe-webgpu` | Opt-in `webgpu.yml` lane (`RUN_WEBGPU=1`, `chromium-webgpu` project) |
| 3    | Any browser, interaction smoke                 | CPU or WebGPU                 | Local dev, opt-in perf runs                   | Opt-in `perf.yml` lane (`RUN_PERF=1`)                                |

## What each tier guarantees

- **Tier 1** is the baseline: full scene, interaction (hover/selection),
  picking, visibility, results, and deformation on a deterministic CPU
  renderer. This is the only tier the default CI gate requires.
- **Tier 2** additionally exercises real GPU buffers, pipelines, instanced
  draws, and GPU picking. It is capability-gated: the demo probes presentation
  and pick readback and falls back to Tier 1 when either is broken (see
  [[webgpu-e2e|WebGPU browser e2e lane]] and
  [[performance-issues|Performance issues and risks]]).
- **Tier 3** is a loose interaction smoke with a generous ceiling; it is a
  regression signal, not a frame-time benchmark.

## Element and rendering-mode coverage

The visual regression lane (`e2e/visual.spec.ts`) pins the deterministic CPU
pixel output for the **solid**, **edge**, and **selection** display modes.
Element-family rendering (point, line, polygon, wire) beyond triangle meshes is
not yet a renderer feature; the element topology and connectivity conventions
that would drive it are covered by the golden fixtures in
`test/elements/golden.ts` (see [[elements-topology|Element topology]]).

Related: [[quality-gate|Quality gate]], [[webgpu-e2e|WebGPU browser e2e lane]],
[[pick-format|Pick texture format]].
