# Platform support: capabilities, fallback, and device recovery

WebGPU is the only rendering backend. Environments without a working WebGPU
path get a predictable, typed "unsupported" result and actionable errors — never
a hang. The CPU-side scene/assembly model is backend-independent, and the demo
owns its own CPU fallback decision, so a missing GPU never blocks model I/O or
computation.

Related: [[architecture/architecture-overview|Architecture overview]],
[[rendering/webgpu-e2e|WebGPU browser e2e lane]], [[architecture/instancing-strategy|Instancing
strategy]], [[architecture/source-organization|Source organization]].

## Capability probing

`queryWebGpuSupport()` (`src/platform/capabilities.ts`) is a non-throwing probe
applications call **before loading a model**. It returns a `WebGpuSupportReport`:

- `status: "supported"` with an `adapter` profile: sorted feature names,
  numeric limits, the software/fallback-adapter flag, and vendor/architecture/
  device/description strings from `GPUAdapterInfo`.
- `status: "unsupported"` with a typed `reason` and a human-readable `message`:
  - `"no-webgpu"` — `navigator.gpu` is not exposed (browser lacks WebGPU).
  - `"adapter-unavailable"` — `requestAdapter` returned `null` or rejected.
  - `"device-unavailable"` — an adapter exists but `requestDevice` failed.

The throwing counterparts (`requestWebGpuAdapter`, `requestWebGpuDevice`) throw
`WebGpuUnsupportedError`, which carries the same typed `reason` so callers can
branch on _why_ WebGPU is unavailable. All entry points accept an optional
`powerPreference`.

## Fallback decision

The renderer itself implements **explicit unsupported**: there is deliberately
no WebGL2 or software-renderer backend inside the library. Rendering without a
GPU is out of scope; the library surface stays small and honest, and the scene
API keeps working so an application can still load, validate, and inspect a
model with no GPU.

The **demo** (`demo/webgpu-probe.ts`) composes the real fallback: it creates a
renderer on a hidden canvas, proves presentation + picking, then either commits
to WebGPU or falls back to a CPU 2D-canvas renderer. That keeps a GPU-less
workstation fully usable while the library keeps one rendering backend. The
opt-in [[rendering/webgpu-e2e|WebGPU e2e lane]] depends on this probe to stay
non-flaky.

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

Tests drive the full loss → blocked-render → recovery → re-upload cycle against
mocked devices (`test/platform/*`, `test/renderer/gpu-recovery.test.ts`,
`test/renderer/gpu-renderer.test.ts`).

## Browser/GPU support

- **Chrome/Edge/Opera (Chromium)**: WebGPU enabled by default; supported.
- **Firefox**: WebGPU on by default since Firefox 141 (previously behind a
  flag); treat as capability-gated.
- **Safari**: WebGPU shipped behind the "WebGPU" experimental flag
  (`safari://settings` → Advanced); capability-gated.
- **No-GPU / software environments**: SwiftShader-backed Chromium can present
  via the opt-in e2e lane; otherwise `requestAdapter` often resolves `null` and
  the typed `"adapter-unavailable"` path applies.

Degraded behavior is always explicit: a typed reason plus guidance text, never a
silent fallback inside the library. Callers check capabilities once up front and
branch on `status`/`reason`.
