# WebGPU browser e2e lane

WebGPU is the product's only renderer, so the WebGPU browser contract is the
**default** e2e lane, not an opt-in. The default `chromium` project launches
Chromium with `--enable-unsafe-webgpu --enable-gpu`, which selects the software
SwiftShader WebGPU implementation — no GPU hardware is required, so the lane
runs on any CI runner and on developer machines.

## How it runs

- `playwright.config.ts` defines a single `chromium` project for all e2e specs,
  launched with the software-WebGPU flags.
- `e2e/webgpu.spec.ts` asserts the WebGPU product contract:
  - **initialization** — the demo commits to the WebGPU renderer;
  - **one instanced render** — the demo's frame counter advances;
  - **interaction/picking** — pointer hover/click drives picking and updates
    the demo's hover/selection state;
  - **clean teardown** — the demo's `window.femgxDemo` seam destroys and
    re-initializes the renderer without page errors;
  - **device-loss recovery** — `window.femgxDemo.forceDeviceLoss()` destroys the
    real GPU device; the demo must recover (status shows `recovered`) or report
    the loss (`data-recovery="error"`), and must not raise page errors either
    way.
  - **display toggles** — the depth-test control stays live, and the removed
    CPU-renderer-only node/normal/face-boundary/ID overlays are no longer
    advertised in the context menu.
  - **rendered pixels** — element emphasis (the context-menu highlight on an
    element target) must visibly change the presented canvas pixels, and
    toggling it off must restore the exact baseline. This catches silent
    WGSL/CPU record-layout desyncs (like #69) that DOM/data-attribute
    assertions cannot see. The comparison captures `canvas.screenshot()` and
    requires several consecutive byte-identical captures, so it also proves
    the WebGPU output is deterministic for a static scene.
- `e2e/visual.spec.ts` additionally pins deterministic pixel output for solid,
  edge, and selection modes using the same settled-screenshot technique.

## Capability gating (non-flakiness)

The lane must never fail on a machine that genuinely cannot initialize WebGPU.
Two layers keep it deterministic:

1. **Explicit unsupported state**: when WebGPU cannot be initialized, the demo
   sets `data-renderer="unsupported"` and shows its error message instead of
   attempting a fallback render.
2. **Spec skip**: tests that need the WebGPU renderer skip cleanly (with a
   reason) when the demo reports `unsupported`, or when GPU picking does not
   resolve any instance.
3. **Settled screenshots**: WebGPU presentation is asynchronous, so the pixel
   tests poll `canvas.screenshot()` until several consecutive captures are
   byte-identical before comparing states. Moving the pointer to an empty canvas
   corner clears the hovered state first, so hover emphasis cannot satisfy (or
   break) the comparison; the test fails (rather than silently passing) if that
   empty spot cannot be found.

So on a healthy WebGPU browser the lane validates the full flow; on a browser
that cannot present/pick it skips instead of failing. These skips are the only
conditional skips left in the suite and are classified as environment capability
coverage in [[engineering/e2e-policy|E2E test classification and skip policy]].
`e2e/skip-summary-reporter.ts` prints the per-reason skip count at the end of
the run so they stay visible and reviewable in CI output.

## Demo test surface

- `data-renderer="webgpu" | "unsupported" | "destroyed"` on the `#view` canvas.
- `data-frames` — successful render count.
- `data-recovery="recovered" | "error"` — outcome of a device loss.
- `data-hovered` / `data-selected` — current hovered/selected instance id
  (empty string when none).
- `window.femgxDemo.destroyRenderer()` / `recreateRenderer()` — explicit
  lifecycle seam used to exercise clean teardown through the demo.
- `window.femgxDemo.forceDeviceLoss()` — destroys the active renderer's GPU
  device to exercise the demo's recovery/report path (see
  [[rendering/platform-support|Platform support]]).

Related: [[engineering/quality-gate|Quality gate]], [[engineering/benchmarks|Benchmarks]],
[[engineering/performance-issues|Performance issues and risks]].
