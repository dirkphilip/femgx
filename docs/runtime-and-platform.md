# Runtime, camera, and WebGPU

This page covers the specialized APIs around the canonical viewport path. The
runtime entrypoint is for CPU inspection only; the platform entrypoint owns the
supported WebGPU path and never supplies a fallback renderer.

## Public symbols

| Symbol                                                                                            | Role                                     |
| ------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| {@link runtime.SceneRuntime SceneRuntime} / {@link runtime.createSceneRuntime createSceneRuntime} | CPU-only compiled-scene inspection       |
| {@link camera.Camera Camera} / {@link camera.createCamera createCamera}                           | Immutable camera state and construction  |
| {@link camera.fitCamera fitCamera} / {@link camera.setProjection setProjection}                   | Camera framing and projection            |
| {@link root.queryWebGpuSupport queryWebGpuSupport}                                                | Non-throwing support probe               |
| {@link platform.requestWebGpuDevice requestWebGpuDevice}                                          | Explicit supported-path device ownership |

## Inspect a scene without a viewport

```ts
import { createSceneRuntime } from "femgx/runtime";

const runtime = createSceneRuntime(scene);
console.log(runtime.getVisiblePartOccurrenceIds());
console.log(runtime.getOccurrences());
```

This is useful for host-side inspection before a canvas or GPU exists. It is
not a second rendering lifecycle. Runtime arrays, packed slots, draw batches,
and GPU record layouts remain implementation details.

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
