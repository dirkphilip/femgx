# FemGx API reference

This is the generated reference for the experimental FemGx 0.x API. The public
API may change without compatibility guarantees.

## Start here

The supported workflow is to define reusable geometry, place it in an
assembly, register the assembly in a scene, and hand that scene to one
viewport:

```ts
import { createFemViewport, createPart, createScene, identity } from "femgx";

const part = createPart(1, {
  positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
  indices: new Uint32Array([0, 1, 2]),
  primitive: "triangles",
});

const scene = createScene()
  .addPart(part)
  .addAssembly({
    id: 1,
    name: "model",
    placements: [{ kind: "part", partId: 1, transform: identity() }],
  })
  .withRoot(1)
  .build();

const viewport = await createFemViewport({ canvas, scene });
```

Start with `createPart`, `createScene`, and `createFemViewport`.
The package has explicit entry points; import advanced or optional domains only
when the host needs them:

| Entry            | Owns                                                                  |
| ---------------- | --------------------------------------------------------------------- |
| `femgx`          | Canonical scene, viewport, interaction, and authored results workflow |
| `femgx/model`    | FE authoring and topology                                             |
| `femgx/io`       | FEM interchange and VTK                                               |
| `femgx/io/glb`   | Optional GLB display-scene import                                     |
| `femgx/camera`   | Camera shells and navigation                                          |
| `femgx/runtime`  | Advanced CPU runtime inspection                                       |
| `femgx/platform` | Supported-path WebGPU primitives                                      |

The generated navigation groups the entry points and their symbols by supported workflow:

- Scene and geometry
- Elements and model editing
- Viewport lifecycle
- Interaction and picking
- Results
- Import and export
- Camera and math
- Advanced runtime and WebGPU platform

The full searchable index remains available in the generated navigation. The
advanced entries document stable supporting utilities and platform-facing
contracts; they are not a second renderer lifecycle.

`createSceneRuntime(scene)` is a CPU-only immutable compiled snapshot for
intentional host inspection. The canonical viewport owns the current live
`SceneRuntime` facade at `viewport.runtime`; reacquire that property after
`setScene()` or `updateScene()`. Runtime queries return defensive snapshots,
and visible placed-part iteration uses `getVisibleInstanceIds()` in deterministic
runtime order. The renderer-shaped `Instance` record and packed slots are
internal.

Use the `Demo` link in the documentation header to return to the live demo.
