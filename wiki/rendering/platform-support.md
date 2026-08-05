# Platform support: WebGPU as the product requirement

Modern WebGPU is the product's only rendering backend. Environments without a
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

The throwing entry points (`requestWebGpuDevice`, and `createWebGpuRenderer`)
throw `WebGpuUnsupportedError`, which carries the same typed `reason`. All entry
points accept an optional `powerPreference`.

## Explicit unsupported

There is deliberately **no second rendering backend**: no WebGL2, no software
renderer, no CPU fallback, and no hidden capability-probe canvas in the library
or the demo. A caller that cannot create a WebGPU renderer receives a
`WebGpuUnsupportedError` (or the typed `queryWebGpuSupport` report) and decides
how to present that to its user. The demo is a thin consumer: it starts the
WebGPU renderer directly and shows the error message in its status line when
WebGPU is unavailable (`data-renderer="unsupported"`).

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
- A renderer built on a caller-provided `device` cannot recreate it; `recover()`
  throws a `WebGpuUnsupportedError` explaining that a new renderer is required.
- `recover()` is a no-op while the device is healthy; `destroy()` stays
  idempotent and ignores loss callbacks that fire after teardown.

Re-creating the device after a loss is **intentionally retained**: device loss is
a normal part of the WebGPU contract on supported hardware (driver resets,
tab eviction), so this is a supported-path feature rather than a fallback for
non-target environments. The demo wires it into `onDeviceLost` and calls
`renderer.recover()` once; if recovery fails it destroys the renderer and shows
the explicit unsupported message (`data-recovery="error"`). There is no CPU
fallback and no canvas replacement.

Tests drive the full loss → blocked-render → recovery → re-upload cycle against
mocked devices (`test/platform/*`, `test/renderer/gpu-recovery.test.ts`,
`test/renderer/gpu-renderer.test.ts`). The e2e lane destroys the real GPU device
through `window.femgxDemo.forceDeviceLoss()` and asserts the demo recovers or
reports the loss without page errors.

## Browser support

- **Chrome/Edge/Opera (Chromium)**: WebGPU enabled by default; supported.
- **Firefox**: WebGPU on by default since Firefox 141 (previously behind a
  flag); treat as capability-gated.
- **Safari**: WebGPU shipped behind the "WebGPU" experimental flag
  (`safari://settings` → Advanced); capability-gated.
- **No-GPU / software environments**: SwiftShader-backed Chromium can present
  via the e2e lane; otherwise `requestAdapter` often resolves `null` and the
  typed `"adapter-unavailable"` path applies.

Degraded behavior is always explicit: a typed reason plus guidance text, never a
silent fallback. Callers check capabilities once up front and branch on
`status`/`reason`.
