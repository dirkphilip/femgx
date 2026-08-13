# Platform support: WebGPU as the product requirement

Modern WebGPU is the product's only rendering backend (see
[[requirements/product-scope|product scope contract]]). Environments without a
working WebGPU path get a predictable, typed "unsupported" result and actionable
errors — never a hang, a silent probe, or a fallback renderer. The CPU-side
scene/assembly model is backend-independent, so model I/O and computation never
require a GPU.

Related: [[architecture/architecture-overview|Architecture overview]],
[[rendering/webgpu-e2e|WebGPU browser e2e lane]], [[architecture/instancing-strategy|Instancing
strategy]], [[architecture/source-organization|Source organization]].

## Capability probing

`queryWebGpuSupport()` (`src/platform/capabilities.ts`) is a non-throwing probe
applications call when they want to branch up front. It returns a
`WebGpuSupportReport`:

- `status: "supported"` with an `adapter` profile: sorted feature names,
  numeric limits, the software/fallback-adapter flag, and vendor/architecture/
  device/description strings from `GPUAdapterInfo`.
- `status: "unsupported"` with a typed `reason` and a human-readable `message`:
  - `"no-webgpu"` — `navigator.gpu` is not exposed (browser lacks WebGPU).
  - `"adapter-unavailable"` — `requestAdapter` returned `null` or rejected.
  - `"device-unavailable"` — an adapter exists but `requestDevice` failed.

The throwing entry points (`requestWebGpuDevice` and `createFemViewport`)
throw `WebGpuUnsupportedError`, which carries the same typed `reason`. The
viewport accepts an optional `powerPreference` and owns renderer creation.

## Explicit unsupported

There is deliberately **no second rendering backend**: no WebGL2, no software
renderer, no CPU fallback, and no hidden capability-probe canvas in the library
or the demo. A caller that cannot create a WebGPU viewport receives a
`WebGpuUnsupportedError` (or the typed `queryWebGpuSupport` report) and decides
how to present that to its user. The demo is a thin consumer: it starts the
canonical viewport and, when WebGPU is unavailable, sets
`data-renderer="unsupported"` and reports that femgx requires a usable WebGPU
renderer, including the probe diagnostic, in its status line. The e2e lane
asserts this contract by hiding `navigator.gpu` before page load and verifying
the demo never starts a 2D CPU renderer.

### Explicit startup failures

The demo reports typed WebGPU support failures as `data-renderer="unsupported"`
with a status-line message: "femgx requires a usable WebGPU renderer" plus the
error detail (a typed `WebGpuUnsupportedError` message already contains the
probe reason, e.g. `navigator.gpu is not exposed`). Shader or pipeline
validation failures are distinct `data-renderer="error"` outcomes with the
labelled compiler diagnostic in the status line. No failure is silently
swallowed: renderer creation, the first frame, and re-creation failures all
report the explicit message and clean up the renderer on the failure path.
The opt-in diagnostics HUD is presentation-only telemetry refreshed from the
workbench after state changes; renderer failure messages remain in the prominent
status UI. Neither path depends on console output.
(The pre-P0 hidden-probe machinery was removed with the CPU fallback. Demo
interaction picking uses the renderer's GPU pick readback path.)

A failed GPU pick readback is reported as a precise pick-path failure, never as
a CPU-only/missing-WebGPU condition: `readPickPixel`
(`src/renderer/gpu-pick.ts`) throws a typed `WebGpuPickReadbackError` when the
asynchronous readback (`copy + mapAsync`) fails after rendering already
succeeded. Callers of the GPU picking path can branch on that type instead of
mislabeling the environment; a successful render is never rejected because an
unrelated optional probe failed.

### High-DPI mobile canvas and readback coordinates

Pick coordinates are converted from CSS client space to device pixels
(`pickPixelCoordinates` in `src/renderer/gpu-pick.ts`) so taps align with what
is drawn even when the CSS size differs from the device-pixel backing size
(`devicePixelRatio > 1`). The renderer sizes the backing store from the CSS
size and `devicePixelRatio` (`GpuRenderer.resize`). Focused tests
(`test/renderer/gpu-pick.test.ts`) cover high-DPI mobile canvas/readback
coordinates, and the e2e lane asserts the canvas backing size and GPU pick
coordinates stay consistent on a high-DPI phone (`e2e/mobile.spec.ts`).

## Device loss and recovery

Device lifetime is centralized in `GpuDeviceLifecycle`
(`src/renderer/gpu-recovery.ts`):

- The renderer subscribes to `GPUDevice.lost` via `watchDeviceLoss`
  (`src/platform/device.ts`). On loss it sets `renderer.lost = true` and fires
  the optional `onDeviceLost` callback with a typed `DeviceLostInfo`.
- Every render/interaction entry point throws a clear
  "device is lost; await `recover()`" error instead of drawing into a dead
  device — no hangs, no undefined-behavior draws.
- `recover()` re-requests a device (respecting the original power preference),
  reconfigures the canvas context, rebuilds the whole resource bundle
  (pipelines, camera buffer, per-part storages, pick targets), re-subscribes to
  the **new** device's `lost` promise, and clears the renderer's per-scene
  layout so the next frame re-uploads everything from the authoritative scene.
- Recovery is single-flight and generation-aware: concurrent calls share one
  rebuild, stale loss callbacks are ignored, and a replacement lost during
  setup remains lost. Destroying during recovery releases the candidate bundle
  when it settles and suppresses late callbacks.
- A renderer built on a caller-provided `device` cannot recreate it; `recover()`
  throws a `WebGpuUnsupportedError` explaining that a new renderer is required.
- `recover()` is a no-op while the device is healthy; `destroy()` stays
  idempotent and ignores loss callbacks that fire after teardown.
- Presentation settings, including the independent point and node glyph
  diameters, remain owned by the renderer across resource replacement and are
  reapplied to the rebuilt camera uniform.

Re-creating the device after a loss is **intentionally retained**: device loss is
a normal part of the WebGPU contract on supported hardware (driver resets,
tab eviction), so this is a supported-path feature rather than a fallback for
non-target environments. `FemViewport` wires device loss into `recover()` and
destroys the failed renderer if recovery is impossible; the demo only maps the
viewport callbacks to status text (`data-recovery="error"`). There is no CPU
fallback and no canvas replacement.

Tests drive the full loss → blocked-render → recovery → re-upload cycle and
deterministic concurrent/destroyed/replacement-loss interleavings against
mocked devices (`test/platform/*`, `test/renderer/gpu-recovery.test.ts`,
`test/renderer/gpu-renderer.test.ts`, `test/viewport/fem-viewport.test.ts`).

## Browser support

Any browser that exposes a working WebGPU device can use the renderer. Browser
version, platform, driver, and policy differences can make WebGPU unavailable,
so callers should use `queryWebGpuSupport()` or handle the typed creation error.
Unsupported behavior is always explicit: a typed reason plus guidance text,
never a silent fallback. Callers branch on `status`/`reason`.

[architecture/architecture-overview|Architecture overview]: ../architecture/architecture-overview.md
[architecture/source-organization|Source organization]: ../architecture/source-organization.md
[rendering/webgpu-e2e|WebGPU browser e2e lane]: webgpu-e2e.md
[requirements/product-scope|product scope contract]: ../requirements/product-scope.md
