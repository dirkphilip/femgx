# WebGPU browser e2e lane

WebGPU is the product's only renderer (see
[[requirements/product-scope|product scope contract]]). The **full** e2e
contract (render, pick, pixels, recovery) runs against **system Chrome with
hardware WebGPU** via `npm run test:e2e`. That is the developer lane today.

CI does **not** use SwiftShader as a stand-in for real WebGPU. Until a GPU
runner exists, CI only runs the no-GPU unsupported-contract smoke
(`npm run test:e2e:ci`).

## How it runs

- `playwright.config.ts` defines:
  - **`chrome`** — `channel: "chrome"` (system Google Chrome), **headed**.
    Hardware WebGPU. Used by `npm run test:e2e` with one worker because parallel
    headed contexts compete for the physical GPU and can yield blank captures
    or stalled readbacks. (Headless Chrome injects SwiftShader; we do not treat
    that as the product lane.)
  - **`chromium`** — Playwright Chromium for the CI no-GPU contract
    (`npm run test:e2e:ci`).
- One-time install: `npm run test:e2e:install` (Chrome + Chromium).
- `e2e/webgpu-lifecycle.spec.ts` owns initialization, one instanced render,
  interaction/picking, clean teardown, re-initialization, and the WebGPU-only
  unsupported contract. CI runs only its unsupported-contract test with
  `navigator.gpu` hidden before page load; the demo must report
  `data-renderer="unsupported"`, state that femgx requires a usable WebGPU
  renderer, include the probe diagnostic, and never start a 2D CPU renderer.
- `e2e/webgpu-rendering.spec.ts` owns rendered pixels, display toggles,
  transparency, overlays, selection, and reload determinism. Captures use
  settled `canvas.screenshot()` comparisons.

## Capability gating (non-flakiness)

The Chrome lane must never fail on a machine that genuinely cannot initialize
WebGPU:

1. **Explicit unsupported state**: when WebGPU cannot be initialized, the demo
   sets `data-renderer="unsupported"` and shows its error message instead of
   attempting a fallback render.
2. **Spec skip**: tests that need the WebGPU renderer skip cleanly (with a
   reason) when the demo reports `unsupported`, or when GPU picking does not
   resolve any instance.
3. **Settled screenshots**: WebGPU presentation is asynchronous, so the pixel
   tests poll `canvas.screenshot()` until several consecutive captures are
   byte-identical before comparing states. Dynamic and focus-sensitive demo
   chrome is masked when the assertion concerns renderer pixels.

## Future: GPU CI runner

A self-hosted (or cloud) runner with a real GPU should run the full
`--project=chrome` suite in CI. Until then, treat local `npm run test:e2e` as
the authoritative WebGPU interaction/pixel gate.

## Demo test surface

The browser contracts have one semantic owner per feature. Workbench DOM and
interaction journeys live in `e2e/demo-lifecycle.spec.ts`,
`e2e/demo-results.spec.ts`, `e2e/demo-visibility.spec.ts`, and
`e2e/demo-interaction.spec.ts`. Real GPU
behavior is partitioned into `e2e/webgpu-lifecycle.spec.ts`,
`e2e/webgpu-rendering.spec.ts`, `e2e/webgpu-camera.spec.ts`, and
`e2e/webgpu-visibility.spec.ts`; their shared settled-pixel and navigation
helpers live in `e2e/webgpu-support.ts`. Mobile layout and touch contracts keep
their deliberate independent suites, while performance remains opt-in.

The former monolithic `demo.spec.ts` and `webgpu.spec.ts` suites were removed so
failure names identify the owning product contract. DOM-only CPU-overlay menu
coverage belongs to the demo interaction suite and is not duplicated in the
WebGPU rendering suite.

- `data-renderer="webgpu" | "unsupported" | "destroyed"` on the `#view` canvas.
- `data-frames` — successful render count.
- `data-recovery="recovered" | "error"` — outcome reported by the viewport after device loss.
- `data-hovered` / `data-selected` — current hovered/selected instance id
  (empty string when none).
- `window.femgxDemo.destroyRenderer()` / `recreateRenderer()` — explicit
  lifecycle seam used to exercise clean teardown through the demo.

Device-loss recovery is covered at the renderer and public viewport API layers
with controlled fake devices; the demo no longer reaches through the viewport
facade to expose its underlying `GPUDevice` solely for a browser-test hook.

Related: [[engineering/quality-gate|Quality gate]], [[engineering/e2e-policy|E2E policy]],
[[engineering/benchmarks|Benchmarks]].

[engineering/benchmarks|Benchmarks]: ../engineering/benchmarks.md
[engineering/e2e-policy|E2E policy]: ../engineering/e2e-policy.md
[engineering/quality-gate|Quality gate]: ../engineering/quality-gate.md
[requirements/product-scope|product scope contract]: ../requirements/product-scope.md
