# WebGPU browser e2e lane

Opt-in browser coverage for the real WebGPU path, kept out of the default CI
gate so the deterministic CPU fallback stays the required default.

## Why it exists

The demo/e2e suite validates the CPU/no-WebGPU fallback, but renderer
regressions in the actual WebGPU path can pass the default workflow unnoticed.
This lane exercises initialization, one instanced render, interaction/picking,
and clean teardown through the public demo path in a real Chromium.

## How it runs

The lane is opt-in via `RUN_WEBGPU=1`:

```sh
RUN_WEBGPU=1 npx playwright test --project=chromium-webgpu
```

- `playwright.config.ts` defines a `chromium-webgpu` project that launches
  Chromium with `--enable-unsafe-webgpu --enable-gpu`. This uses the software
  SwiftShader WebGPU implementation, so **no GPU hardware is required** and the
  lane can run on any CI runner. The project only matches `e2e/webgpu.spec.ts`;
  the default `chromium` project excludes that file and launches with
  `--disable-gpu`, so it always exercises the deterministic CPU fallback even
  on hosts that would otherwise expose a WebGPU adapter; the default gate is
  untouched.
- `.github/workflows/webgpu.yml` runs the lane on `workflow_dispatch` (opt-in,
  mirroring the [[engineering/benchmarks|performance]] workflow). The default
  `.github/workflows/ci.yml` continues to run the CPU-fallback e2e.
- `e2e/webgpu.spec.ts` asserts:
  - **initialization** — the demo commits to the WebGPU renderer;
  - **one instanced render** — the demo's frame counter advances;
  - **interaction/picking** — pointer hover/click drives GPU picking and updates
    the demo's hover/selection state;
  - **clean teardown** — the demo's `window.femgxDemo` seam destroys and
    re-initializes the renderer without page errors;
  - **device-loss recovery** — `window.femgxDemo.forceDeviceLoss()` destroys the
    real GPU device; the demo must recover (status shows `recovered`) or fall
    back to the CPU renderer, and must not raise page errors either way.
  - **display-overlay toggles** — the node-marker/normal/face-boundary/ID
    context-menu toggles are disabled and annotated "CPU renderer only" (the
    WebGPU path has no overlay passes yet) while the edge overlay stays
    enabled.

## Capability gating (non-flakiness)

The lane must never make the default CI lane flaky or depend on GPU hardware.
Two layers keep it deterministic:

1. **Demo probe** (`demo/webgpu-probe.ts`): after creating a WebGPU renderer the
   demo renders one frame and requires a real pick hit near the model center. If
   presentation, rasterization, or pick readback are broken, it destroys the
   renderer and falls back to the deterministic CPU (2D canvas) path.
2. **Spec skip**: each test skips cleanly (with a reason) when the demo did not
   commit to WebGPU, or when GPU picking does not resolve any instance.

So on a healthy WebGPU browser the lane validates the full flow; on a browser
that cannot present/pick (for example headless SwiftShader quirks, see
[[engineering/performance-issues|Performance issues and risks]]) it skips instead of failing.

## Demo test surface

- `data-renderer="webgpu" | "cpu" | "destroyed"` on the `#view` canvas.
- `data-frames` — successful render count.
- `data-recovery="recovered" | "cpu-fallback"` — outcome of a device loss.
- `data-hovered` / `data-selected` — current hovered/selected instance id
  (empty string when none).
- `window.femgxDemo.destroyRenderer()` / `recreateRenderer()` — explicit
  lifecycle seam used to exercise clean teardown through the demo.
- `window.femgxDemo.forceDeviceLoss()` — destroys the active renderer's GPU
  device to exercise the demo's recovery/fallback path (see
  [[rendering/platform-support|Platform support: capabilities, fallback, and device recovery]]).

Related: [[engineering/quality-gate|Quality gate]], [[engineering/benchmarks|Benchmarks]],
[[engineering/performance-issues|Performance issues and risks]].
