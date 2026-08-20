# Scenes, parts, and finite-element models

This guide covers the data that exists before a viewport is created. The
public entrypoints are `femgx`, `femgx/model`, and `femgx/io`.

## Public symbols

| Symbol                                                                                        | Role                                            |
| --------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| {@link root.Part Part} / {@link root.createPart createPart}                                   | Immutable reusable display geometry             |
| {@link root.Scene Scene} / {@link root.createSceneBuilder createSceneBuilder}                 | Authored definitions and root assembly          |
| {@link model.ElementModel ElementModel} / {@link model.createElementModel createElementModel} | Dense FE nodes, elements, and optional bodies   |
| {@link model.createElement createElement} / {@link model.ElementShape ElementShape}           | Validated element connectivity and topology     |
| {@link model.createPartFromElementModel createPartFromElementModel}                           | FE model to reusable renderable part            |
| {@link model.createPartFromExplicitTopology createPartFromExplicitTopology}                   | Host-authored surface, line, and point geometry |

Both constructors return a reusable `Part`, not a `Mesh`. A `Part` includes
renderable geometry together with the authored element/node/body identities and
scene-facing mappings needed by results, picking, and assembly instancing.

### Migration from 0.1 previews

The experimental API has no compatibility aliases; update imports directly:

| Previous name               | New name                            |
| --------------------------- | ----------------------------------- |
| `elementPart`               | `createPartFromElementModel`        |
| `surfacePart`               | `createPartFromExplicitTopology`    |
| `TessellationOptions`       | `CreatePartFromElementModelOptions` |
| `SurfacePartInput`          | `ExplicitTopologyInput`             |
| `SurfacePartError`          | `ExplicitTopologyError`             |
| `SurfacePartValidationCode` | `ExplicitTopologyValidationCode`    |

`createPartFromElementModel` tessellates authored finite-element topology while
retaining its semantic mappings. `createPartFromExplicitTopology` retains the
facets, lines, and points supplied by the host. Its facet input may be open,
disconnected, overlapping, or non-manifold: “explicit topology” describes the
representation, not a promise that the facets form a closed mathematical
surface.

Facets always have stable element ownership. To render and interact only at
element and node granularity, omit `faceIndices`; the resulting part has no
authored face, neighbor, or facet-derived edge identity. Add aligned
`faceIndices` and optional `neighbors` only when face interaction is needed.
All facet, line, and point connectivity indexes the same dense part-local
`positions` table, copied once by the constructor.

## The canonical flow

```text
Part definitions + assembly placements → Scene → Viewport → occurrences
```

A `Part` is local immutable geometry. An assembly placement references that
definition and contributes a transform; it never copies the geometry. A
`Scene` registers the definitions and one root assembly. The compiled runtime
expands placements into occurrence identities while retaining shared geometry.

## Raw display geometry

Use {@link root.createPart createPart} when the host already owns
display geometry rather than FE connectivity. Each geometry group has a
`primitive` (`"triangles"`, `"lines"`, or `"points"`), positions, and indices.

```ts
import { createPart, createSceneBuilder, createViewport, identityMatrix } from "femgx";

const part = createPart(10, {
  geometries: [
    {
      primitive: "triangles",
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      indices: new Uint32Array([0, 1, 2]),
    },
  ],
});

const scene = createSceneBuilder()
  .addPart(part)
  .addAssembly({
    id: 20,
    name: "root",
    placements: [{ kind: "part", partId: part.id, transform: identityMatrix() }],
  })
  .setRootAssembly(20)
  .build();

const viewport = await createViewport({ canvas, scene });
viewport.view.fit();
```

`createPart` validates finite coordinates, array lengths, index bounds, and
the part id. The returned part owns its typed arrays. Raw geometry has no
implicit element or node semantics; use `createPartFromElementModel` when those identities
matter.

## Typed FE geometry

{@link model.createElement createElement} validates one element, while
{@link model.createElementModel createElementModel} validates the complete
node/element collection. Node ids are dense and zero-based. Element ids remain
authored identities, so tessellation does not replace the ids used by picking,
selection, or elemental results.

```ts
import {
  ElementShape,
  createElement,
  createElementModel,
  createPartFromElementModel,
} from "femgx/model";

const model = createElementModel(
  new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]),
  [
    createElement(100, ElementShape.Triangle, [0, 1, 2]),
    createElement(101, ElementShape.Triangle, [0, 2, 3]),
  ],
  { bodies: [{ id: 7, name: "plate", elementIds: [100, 101] }] },
);
const part = createPartFromElementModel(30, model);
```

Bodies are optional direct element ownership. There is no public semantic block
layer. {@link model.createPartFromElementModel createPartFromElementModel} creates homogeneous
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
import { identityMatrix, translationMatrix } from "femgx";

const scene = createSceneBuilder()
  .addPart(part)
  .addAssembly({
    id: 40,
    name: "root",
    placements: [
      {
        kind: "part",
        placementId: "left",
        partId: part.id,
        transform: identityMatrix(),
      },
      {
        kind: "part",
        placementId: "right",
        partId: part.id,
        transform: translationMatrix(2, 0, 0),
      },
    ],
  })
  .setRootAssembly(40)
  .build();
```

The two placements share the part geometry but have independent transforms,
visibility, selection, and pick identities. Use the stable occurrence handles
from `viewport.occurrences`; renderer slots and GPU buffers are intentionally private.

## Host model conversion

For serializable host data, use {@link io.createFemModelBuilder createFemModelBuilder},
{@link io.validateFemModel validateFemModel}, and
{@link io.createElementModelFromFemModel createElementModelFromFemModel}.
Validate once at the IO boundary, convert once to the typed FE model, and then
follow the ordinary `createPartFromElementModel → Scene → Viewport` path. Result payloads use
{@link io.createResultFieldFromModelResult createResultFieldFromModelResult}.

The conversion requires dense node ordinals for rendering but preserves
authored element ids. If the host already has validated direct body ownership,
pass it through the conversion options instead of rebuilding the model.

## Related pages

- [Viewport lifecycle and interaction](viewport-interaction.md)
- [Results and import](results-and-import.md)
- [Runtime, camera, and WebGPU](runtime-and-platform.md)
