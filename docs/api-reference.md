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

See the [0.x entry-point migration map](migration-0.x-entry-points.md) when
updating an existing root import.

The generated navigation groups the entry points and their symbols by supported workflow:

- Scene and geometry
- Elements and model editing
- Viewport lifecycle
- Interaction and picking
- Results
- Import and export
- Camera and math
- Advanced runtime and WebGPU platform

## Supported journeys

### FE authoring

Use `femgx/model` to author typed elements and compile one reusable `Part`; use
the root entry for placement and rendering:

```ts
import { createFemViewport, createScene, identity } from "femgx";
import { createElement, createElementModel, elementPart, TRIANGLE_SHAPE } from "femgx/model";

const model = createElementModel(nodes, [createElement(1, TRIANGLE_SHAPE, [0, 1, 2])]);
const part = elementPart(1, model);
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

### VTK and GLB interchange

`femgx/io` owns validated FEM/VTK conversion. The optional GLB importer is a
separate entry so hosts that do not import it avoid its dependency closure:

```ts
import { createFemViewport } from "femgx";
import { createElementModelFromFemModel, parseVtk } from "femgx/io";
import { importGlb } from "femgx/io/glb";

const vtk = parseVtk(vtkText);
const vtkModel = createElementModelFromFemModel(vtk.model);
const imported = await importGlb(glbBytes);
const viewport = await createFemViewport({ canvas, scene: imported.scene });
void vtkModel;
void viewport;
```

### Advanced CPU and camera ownership

Use `femgx/runtime` only for an intentional standalone CPU snapshot; the
ordinary viewport exposes its current live facade at `viewport.runtime`. Use
`femgx/camera` when building a custom camera shell, and `femgx/platform` when
the host explicitly owns adapter/device setup:

```ts
import { createScene } from "femgx";
import { createCamera, installCameraControls } from "femgx/camera";
import { createSceneRuntime } from "femgx/runtime";
import { queryWebGpuSupport, requestWebGpuDevice } from "femgx/platform";

const camera = createCamera();
const runtime = createSceneRuntime(createScene().build());
const support = await queryWebGpuSupport();
void installCameraControls;
void requestWebGpuDevice;
void camera;
void runtime;
void support;
```

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
