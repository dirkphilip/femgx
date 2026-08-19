# Scenes, parts, and finite-element models

This guide covers the data that exists before a viewport is created. The
public entrypoints are [`femgx`](https://github.com/dirkphilip/femgx/blob/main/src/entries/root.ts),
[`femgx/model`](https://github.com/dirkphilip/femgx/blob/main/src/entries/model.ts), and
[`femgx/io`](https://github.com/dirkphilip/femgx/blob/main/src/entries/io.ts).

## Public symbols

| Symbol                                                                                                                                                                                      | Role                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| [`Part`](https://github.com/dirkphilip/femgx/blob/main/src/geometry/part.ts#L46) / [`createPart`](https://github.com/dirkphilip/femgx/blob/main/src/geometry/part.ts#L121)                  | Immutable reusable display geometry             |
| [`Scene`](https://github.com/dirkphilip/femgx/blob/main/src/scene/scene.ts#L16) / [`createScene`](https://github.com/dirkphilip/femgx/blob/main/src/scene/scene.ts#L361)                    | Authored definitions and root assembly          |
| [`ElementModel`](https://github.com/dirkphilip/femgx/blob/main/src/elements/model.ts#L27) / [`createElementModel`](https://github.com/dirkphilip/femgx/blob/main/src/elements/model.ts#L56) | Dense FE nodes, elements, and optional bodies   |
| [`createElement`](https://github.com/dirkphilip/femgx/blob/main/src/elements/element.ts#L51) / [`ElementShape`](https://github.com/dirkphilip/femgx/blob/main/src/elements/shapes.ts)       | Validated element connectivity and topology     |
| [`elementPart`](https://github.com/dirkphilip/femgx/blob/main/src/geometry/element-part.ts#L67)                                                                                             | FE model to reusable renderable part            |
| [`surfacePart`](https://github.com/dirkphilip/femgx/blob/main/src/geometry/surface-part.ts#L42)                                                                                             | Host-authored surface, line, and point geometry |

## The canonical flow

```text
Part definitions + assembly placements → Scene → SceneRuntime → Viewport
```

A `Part` is local immutable geometry. An assembly placement references that
definition and contributes a transform; it never copies the geometry. A
`Scene` registers the definitions and one root assembly. The compiled runtime
expands placements into occurrence identities while retaining shared geometry.

## Raw display geometry

Use [`createPart`](https://github.com/dirkphilip/femgx/blob/main/src/geometry/part.ts#L121) when the host already owns
display geometry rather than FE connectivity. Each geometry group has a
`primitive` (`"triangles"`, `"lines"`, or `"points"`), positions, and indices.

```ts
import { createPart, createScene, createViewport, identity } from "femgx";

const part = createPart(10, {
  geometries: [
    {
      primitive: "triangles",
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      indices: new Uint32Array([0, 1, 2]),
    },
  ],
});

const scene = createScene()
  .addPart(part)
  .addAssembly({
    id: 20,
    name: "root",
    placements: [{ kind: "part", partId: part.id, transform: identity() }],
  })
  .withRoot(20)
  .build();

const viewport = await createViewport({ canvas, scene });
viewport.view.fit();
```

`createPart` validates finite coordinates, array lengths, index bounds, and
the part id. The returned part owns its typed arrays. Raw geometry has no
implicit element or node semantics; use `elementPart` when those identities
matter.

## Typed FE geometry

[`createElement`](https://github.com/dirkphilip/femgx/blob/main/src/elements/element.ts#L51) validates one element, while
[`createElementModel`](https://github.com/dirkphilip/femgx/blob/main/src/elements/model.ts#L56) validates the complete
node/element collection. Node ids are dense and zero-based. Element ids remain
authored identities, so tessellation does not replace the ids used by picking,
selection, or elemental results.

```ts
import { ElementShape, createElement, createElementModel, elementPart } from "femgx/model";

const model = createElementModel(
  new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]),
  [
    createElement(100, ElementShape.Triangle, [0, 1, 2]),
    createElement(101, ElementShape.Triangle, [0, 2, 3]),
  ],
  { bodies: [{ id: 7, name: "plate", elementIds: [100, 101] }] },
);
const part = elementPart(30, model);
```

Bodies are optional direct element ownership. There is no public semantic block
layer. [`elementPart`](https://github.com/dirkphilip/femgx/blob/main/src/geometry/element-part.ts#L67) creates homogeneous
primitive groups for rendering while retaining the model's semantic element,
face, edge, body, and node mappings.

## Assemblies and occurrence identity

Keep these identities distinct:

| Identity               | Meaning                                   |
| ---------------------- | ----------------------------------------- |
| `partId`               | One reusable local geometry definition    |
| `placementId`          | One authored reference inside an assembly |
| `partOccurrenceId`     | One expanded placed-part identity         |
| `assemblyOccurrenceId` | One expanded assembly-node identity       |

```ts
import { identity, translation } from "femgx";

const scene = createScene()
  .addPart(part)
  .addAssembly({
    id: 40,
    name: "root",
    placements: [
      {
        kind: "part",
        placementId: "left",
        partId: part.id,
        transform: identity(),
      },
      {
        kind: "part",
        placementId: "right",
        partId: part.id,
        transform: translation(2, 0, 0),
      },
    ],
  })
  .withRoot(40)
  .build();
```

The two placements share the part geometry but have independent transforms,
visibility, selection, and pick identities. Use the stable runtime handles from
`viewport.runtime`; renderer slots and GPU buffers are intentionally private.

## Host model conversion

For serializable host data, use [`createModelBuilder`](https://github.com/dirkphilip/femgx/blob/main/src/io/model-builder.ts#L171),
[`validateModel`](https://github.com/dirkphilip/femgx/blob/main/src/io/model-validation.ts), and
[`createElementModelFromFemModel`](https://github.com/dirkphilip/femgx/blob/main/src/io/conversions/element-model.ts#L36).
Validate once at the IO boundary, convert once to the typed FE model, and then
follow the ordinary `elementPart → Scene → Viewport` path. Result payloads use
[`createResultFieldFromModelResult`](https://github.com/dirkphilip/femgx/blob/main/src/io/conversions/result-field.ts#L58).

The conversion requires dense node ordinals for rendering but preserves
authored element ids. If the host already has validated direct body ownership,
pass it through the conversion options instead of rebuilding the model.

## Related pages

- [Viewport lifecycle and interaction](viewport-interaction.md)
- [Results and import](results-and-import.md)
- [Runtime, camera, and WebGPU](runtime-and-platform.md)
- [0.x entry-point migration](migration-0.x-entry-points.md)
