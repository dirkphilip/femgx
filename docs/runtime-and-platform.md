# Runtime, camera, and WebGPU

This page covers the specialized APIs around the canonical viewport path. The
viewport owns compiled-scene inspection; the platform entrypoint owns the
supported WebGPU path and never supplies a fallback renderer.

## Public symbols

| Symbol                                                                                                                                                                          | Role                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| [`Camera`](https://github.com/dirkphilip/femgx/blob/main/src/camera/camera.ts#L14) / [`createCamera`](https://github.com/dirkphilip/femgx/blob/main/src/camera/camera.ts#L84)   | Immutable camera state and construction  |
| [`fitCamera`](https://github.com/dirkphilip/femgx/blob/main/src/camera/fit.ts#L34) / [`setProjection`](https://github.com/dirkphilip/femgx/blob/main/src/camera/camera.ts#L115) | Camera framing and projection            |
| [`queryWebGpuSupport`](https://github.com/dirkphilip/femgx/blob/main/src/platform/capabilities.ts#L172)                                                                         | Non-throwing support probe               |
| [`requestWebGpuDevice`](https://github.com/dirkphilip/femgx/blob/main/src/platform/device.ts#L25)                                                                               | Explicit supported-path device ownership |

## Inspect placed occurrences

Use the viewport's stable occurrence inspection facade for hierarchy, world
transforms, and effective visibility. Packed runtime arrays, slots, draw
batches, and GPU record layouts remain implementation details; there is no
standalone runtime package entry or second rendering lifecycle.

## Custom camera state

```ts
import { createViewport } from "femgx";
import { createCamera, setProjection } from "femgx/camera";

const camera = setProjection(createCamera({ width: 800, height: 480 }), "perspective");
const viewport = await createViewport({ canvas, scene, camera });
viewport.view.setCamera(camera, { durationMs: 250 });
```

Call `viewport.resize()` after the host applies a new CSS canvas size. The
viewport's `view.fit` and `view.fitSelection` share one interruptible transition
path. A positive finite duration animates; zero or omitted duration applies
immediately. A host may provide `keyboardTarget` for the `Z` fit-selection
shortcut; FemGx installs no implicit global keyboard listener.

## Probe WebGPU support

```ts
import { queryWebGpuSupport } from "femgx";

const support = await queryWebGpuSupport({
  powerPreference: "high-performance",
});
if (support.status !== "supported") {
  statusElement.textContent = support.message;
}
```

`createViewport` requests the device itself. If no working device is available,
it rejects with `WebGpuUnsupportedError` and a typed reason. A supported-path
device loss can be handled with `await viewport.recover()`; recovery retains the
scene and current authored snapshot. There is no CPU or compatibility backend.

## Intentional boundaries

The public API does not provide a CPU renderer, generalized geometry-query
subsystem, femgx-owned result timeline, derived engineering quantities, broad
interchange adapters, GLB FE semantics, or renderer slot/buffer access. Hosts
own model/result sequencing and UI policy; FemGx owns validation, scene
compilation, and the WebGPU viewport lifecycle.

## Related pages

- [Scenes and finite-element models](scene-and-model.md)
- [Viewport lifecycle and interaction](viewport-interaction.md)
- [Results and import](results-and-import.md)
- [WebGPU platform contract](https://github.com/dirkphilip/femgx/blob/main/wiki/rendering/platform-support.md)
