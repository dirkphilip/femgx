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
    Hardware WebGPU. Used by `npm run test:e2e`. (Headless Chrome injects
    SwiftShader; we do not treat that as the product lane.)
  - **`chromium`** — Playwright Chromium for the CI no-GPU contract
    (`npm run test:e2e:ci`).
- One-time install: `npm run test:e2e:install` (Chrome + Chromium).
- `e2e/webgpu.spec.ts` asserts the WebGPU product contract on the Chrome lane:
  - **initialization** — the demo commits to the WebGPU renderer;
  - **one instanced render** — the demo's frame counter advances;
  - **interaction/picking** — pointer hover/click drives picking and updates
    the demo's hover/selection state;
  - **clean teardown** — the demo's `window.femgxDemo` seam destroys and
    re-initializes the renderer without page errors;
  - **WebGPU-only unsupported contract** — with `navigator.gpu` hidden before
    page load, the demo must report `data-renderer="unsupported"`, state that
    femgx requires a usable WebGPU renderer, include the probe diagnostic, and
    never start a 2D CPU renderer for the model view. This test is what CI runs.
  - **display toggles** — the depth-test control stays live, and the removed
    CPU-renderer-only node/normal/face-boundary/ID overlays are no longer
    advertised in the context menu.
  - **rendered pixels** — element emphasis must visibly change the presented
    canvas pixels. Captures use settled `canvas.screenshot()` comparisons.
- `e2e/visual.spec.ts` additionally pins deterministic pixel output for solid,
  edge, and selection modes using the same settled-screenshot technique.

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
   byte-identical before comparing states.

## Future: GPU CI runner

A self-hosted (or cloud) runner with a real GPU should run the full
`--project=chrome` suite in CI. Until then, treat local `npm run test:e2e` as
the authoritative WebGPU interaction/pixel gate.

## Demo test surface

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
