# WebGPU browser e2e lane

WebGPU is the product's only renderer (see
[[requirements/product-scope|product scope contract]]). The **full** e2e
contract (render, pick, pixels, recovery) runs against **system Chrome with
hardware WebGPU** via `npm run test:e2e`. That is the developer lane today.

CI does **not** use SwiftShader as a stand-in for real WebGPU. Merge CI runs the
no-GPU unsupported-contract smoke (`npm run test:e2e:no-gpu`). A separate
manual conformance workflow records hardware evidence without weakening that
merge contract.

## How it runs

- `playwright.config.ts` defines:
  - **`chrome`** — `channel: "chrome"` (system Google Chrome), headless with
    `--enable-gpu` and Playwright's `--enable-unsafe-swiftshader` default
    removed. Hardware WebGPU without a visible browser window. Used by
    `npm run test:e2e` with one worker because parallel contexts compete for the
    physical GPU and can yield blank captures or stalled readbacks. The lane
    also asserts that Chrome did not select a fallback or SwiftShader adapter.
  - **`chrome-unsupported`** — the runner's installed branded Google Chrome
    for the CI no-GPU contract (`npm run test:e2e:no-gpu`), which runs the
    direct-core typed unsupported journey only.
- One-time install: `npm run test:e2e:install` (Playwright Chrome for the local
  WebGPU lane; hosted CI uses its preinstalled Chrome).
- Add Playwright's `--headed` option for an intentionally visible debugging run.
- `e2e/core/core-foundation.spec.ts` owns one direct public-entry viewport
  create/render/destroy journey and one typed unsupported journey. Its host
  imports only the explicit `src/entries/*` facades and owns one
  canvas/viewport lifecycle.
- `e2e/core/core-journeys.spec.ts` owns hardware lifecycle, camera commands,
  picking, region selection, and representative nonblank rendering. The
  direct-core foundation suite owns the typed unsupported contract with
  `navigator.gpu` hidden before page load; the public viewport must reject
  startup with `WebGpuUnsupportedError` and never start a 2D CPU renderer.
- The demo suites own semantic workbench journeys: `demo-lifecycle`,
  `demo-results`, `demo-visibility`, `demo-interaction`, `demo-import`,
  `mobile`, `demo-layout`, and `smoke`. Pixel-heavy exploration and sustained
  performance remain opt-in.

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

## Cross-vendor conformance evidence

Run `npm run test:e2e:conformance` for the bounded local journey, or dispatch
`Hardware WebGPU conformance` in GitHub Actions to compare Apple and
Windows/NVIDIA. The workflow discovers online self-hosted runners by these
fixed labels:

- `femgx-webgpu-apple` — system Chrome on Apple hardware and macOS;
- `femgx-webgpu-nvidia` — system Chrome on NVIDIA hardware and Windows.

The journey deterministically combines perspective projection, authored scalar
color, simultaneous selection and highlight, transparency, a section plane,
region and point picking, and orientation-gizmo interaction. It retains JSON
adapter/browser identity plus full-page desktop and 390×844 screenshots for 30
days. The comparison verifies the expected operating system and adapter vendor,
rejects fallback/software adapters, and requires both captures and all semantic
assertions. A requested target without an online labelled runner is reported as
**unavailable** and fails the workflow; it is never converted into a skip or a
green result. This is a correctness comparison, not a cross-device frame-rate
benchmark.

The complete local `npm run test:e2e` system-Chrome suite remains the
authoritative pre-merge interaction/pixel gate. The manual cross-vendor lane
adds retained hardware evidence for the bounded combined journey.

## Demo test surface

The browser contracts have one semantic owner per feature. Workbench DOM and
interaction journeys live in `e2e/demo/demo-lifecycle.spec.ts`,
`e2e/demo/demo-results.spec.ts`, `e2e/demo/demo-visibility.spec.ts`,
`e2e/demo/interaction/selection.spec.ts`,
`e2e/demo/interaction/primitives.spec.ts`, `e2e/demo/demo-import.spec.ts`,
`e2e/demo/mobile.spec.ts`, and `e2e/demo/demo-layout.spec.ts`. Core browser
journeys own low-level GPU lifecycle, camera, picking, and raster contracts;
owner-neutral mechanics live in `e2e/browser-support/helpers.ts`. Performance remains
opt-in.

- `data-renderer="webgpu" | "unsupported" | "error" | "destroyed"` on the `#view` canvas.
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
