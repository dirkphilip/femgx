# FemGx API reference

FemGx is a strongly typed TypeScript library for rendering finite-element
scenes with WebGPU and GPU instancing. The shortest path is:

```text
part definition → assembly placement → Scene → Viewport
```

The generated symbol reference begins below this overview. The task-focused
guides keep the recipes readable and link each important type and function to
its generated TypeDoc declaration.

## Five-minute workflow

```ts
import { createSceneBuilder, createViewport, identityMatrix } from "femgx";
import {
  ElementShape,
  createElement,
  createElementModel,
  createPartFromElementModel,
} from "femgx/model";

const model = createElementModel(new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0]), [
  createElement(100, ElementShape.Triangle, [0, 1, 2]),
]);
const part = createPartFromElementModel(10, model);
const scene = createSceneBuilder()
  .addPart(part)
  .addAssembly({
    id: 20,
    name: "root",
    placements: [{ kind: "part", partId: part.id, transform: identityMatrix() }],
  })
  .setRootAssembly(20)
  .build();

const canvas = document.querySelector<HTMLCanvasElement>("#femgx-viewport");
if (canvas === null) throw new Error("Missing #femgx-viewport canvas");
const viewport = await createViewport({ canvas, scene });
viewport.view.fit();
```

`createViewport` requests a real WebGPU adapter and device. Unsupported
environments receive a typed result or error; there is no CPU renderer. Call
`viewport.destroy()` when the host removes the canvas.

## Choose the entrypoint

| Entry               | Use it for                                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `femgx`             | Parts, scenes, viewport lifecycle, common math, picking, and support probing                                        |
| `femgx/model`       | FE elements, typed models, `createPartFromElementModel`, `createPartFromExplicitTopology`, shapes, faces, and edges |
| `femgx/io`          | Serializable FEM models, validation, diagnostics, and result conversion                                             |
| `femgx/io/glb`      | Self-contained GLB 2.0 display-scene import                                                                         |
| `femgx/camera`      | Camera construction, fitting, projection, and custom controls                                                       |
| `femgx/interaction` | Interaction state, target mapping, and host-owned selection policy                                                  |
| `femgx/results`     | Authored fields, ranges, color mapping, and deformation                                                             |
| `femgx/platform`    | Explicit supported-path WebGPU adapter/device ownership                                                             |

Do not import `importGlb` from `femgx`; it is published only from
`femgx/io/glb`.

## Focused guides

- [Scenes, parts, and finite-element models](scene-and-model.md) — reusable
  geometry, FE topology, assemblies, occurrences, and host model conversion.
- [Viewport lifecycle and interaction](viewport-interaction.md) — picking,
  selection, visibility, transactional scene updates, and teardown.
- [Results and import](results-and-import.md) — authored scalar/vector fields,
  deformation, orientation glyphs, FEM input, and GLB display scenes.
- [Runtime, camera, and WebGPU](runtime-and-platform.md) — CPU inspection,
  custom camera state, support probing, and device recovery.

## Ownership model

{@link root.Part | Part} is immutable local geometry. A
{@link root.Scene | Scene} owns part and assembly definitions. The
{@link root.Viewport | Viewport} owns the live compiled runtime,
WebGPU resources, camera, interaction, results, visibility, recovery, and
teardown. Reusable definitions are never copied for placements; occurrence
identity is derived by the scene runtime.

Capability objects are stable non-owning views into the live viewport state:

```ts
viewport.view.camera;
viewport.interaction.state;
viewport.visibility.setPartVisible(part.id, false);
viewport.visibility.setPartOccurrences(partOccurrenceIds, false);
viewport.results.state;
viewport.presentation.setBackground("dark");
```

Use `viewport.occurrences` to inspect the viewport's current expanded
placements. The capability object remains stable across `replaceScene()` and
committed `updateScene()` calls.

## Public entrypoints

| Package entry       | TypeScript facade                                                                                        |
| ------------------- | -------------------------------------------------------------------------------------------------------- |
| `femgx`             | [`src/entries/root.ts`](https://github.com/dirkphilip/femgx/blob/main/src/entries/root.ts)               |
| `femgx/model`       | [`src/entries/model.ts`](https://github.com/dirkphilip/femgx/blob/main/src/entries/model.ts)             |
| `femgx/io`          | [`src/entries/io.ts`](https://github.com/dirkphilip/femgx/blob/main/src/entries/io.ts)                   |
| `femgx/io/glb`      | [`src/entries/io/glb.ts`](https://github.com/dirkphilip/femgx/blob/main/src/entries/io/glb.ts)           |
| `femgx/camera`      | [`src/entries/camera.ts`](https://github.com/dirkphilip/femgx/blob/main/src/entries/camera.ts)           |
| `femgx/interaction` | [`src/entries/interaction.ts`](https://github.com/dirkphilip/femgx/blob/main/src/entries/interaction.ts) |
| `femgx/results`     | [`src/entries/results.ts`](https://github.com/dirkphilip/femgx/blob/main/src/entries/results.ts)         |
| `femgx/platform`    | [`src/entries/platform.ts`](https://github.com/dirkphilip/femgx/blob/main/src/entries/platform.ts)       |

The generated navigation is the searchable reference for every exported
symbol. The guides above are organized around host tasks so that the API is
readable without one nine-hundred-line page.
