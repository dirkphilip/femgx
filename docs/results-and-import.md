# Results and import

Results are authored snapshots. FemGx validates and presents scalar fields,
nodal deformation, and bounded elemental orientation; it does not derive
engineering quantities or own a result timeline.

## Public symbols

| Symbol                                                                                        | Role                                        |
| --------------------------------------------------------------------------------------------- | ------------------------------------------- |
| {@link results.ResultField ResultField} / {@link results.createResultField createResultField} | Typed nodal or elemental scalar/vector data |
| {@link results.scalarRange scalarRange}                                                       | Finite authored scalar range                |
| {@link results.createElementFrameField createElementFrameField}                               | Authored elemental orientation frames       |
| {@link io.createResultFieldFromModelResult createResultFieldFromModelResult}                  | IO result conversion                        |
| {@link io.FemModel FemModel} / {@link io/glb.importGlb}                                       | Serializable FE and GLB input boundaries    |

## Scalar fields and deformation

Create a field with one value per authored node or element. Values are
index-aligned to the owning model; `NaN` means authored data is missing.

```ts
import { createResultField, scalarRange } from "femgx/results";

const temperature = createResultField({
  id: "temperature-step-1",
  name: "Temperature",
  location: "nodal",
  shape: "scalar",
  count: 4,
  unit: "degC",
  values: new Float32Array([20, 40, 65, 30]),
});
const displacement = createResultField({
  id: "displacement-step-1",
  name: "Displacement",
  location: "nodal",
  shape: "vector",
  count: 4,
  unit: "mm",
  values: new Float32Array([0, 0, 0, 0, 0, 0.05, 0, 0, 0.1, 0, 0, 0.05]),
});

const range = scalarRange(temperature);
viewport.results.set({
  scalar: { field: temperature, ...(range === undefined ? {} : { range }) },
  deformation: { field: displacement, scale: 1.5 },
});
```

`viewport.results.set` is atomic across scalar, deformation, loads, and
orientation roles. To show a host-owned sequence, call it again with the next
snapshot; FemGx retains only the current one. Structural coverage is validated
separately from data completeness, so an addressed entity may still have `NaN`.

Elemental fields address authored element ids, not tessellated triangle indices.
The dense `count` must cover the highest rendered id, while unrelated entries
may remain `NaN`.

## Elemental orientation

An elemental vector field can drive a bounded `arrow` or `axis` glyph:

```ts
const directions = createResultField({
  id: "fiber-direction-step-1",
  name: "Fiber direction",
  location: "elemental",
  shape: "vector",
  count: 102,
  unit: "unit-vector",
  values: directionValues,
});

viewport.results.set({
  orientation: {
    field: directions,
    glyph: "arrow",
    transform: "direction",
    lengthScale: 0.25,
    widthPixels: 2,
  },
});
```

Arrows accept `direction` or `normal`; axes accept only `direction`. FemGx does
not compute magnitudes, tensors, legends, or playback controls.

## Serializable FE input

The `femgx/io` entrypoint is a narrow staging boundary:
validate the host payload, convert it once, and continue through the ordinary
model workflow.

```ts
import { ElementShape } from "femgx/model";
import { createElementModelFromFemModel, createModelBuilder, validateModel } from "femgx/io";
import { elementPart } from "femgx/model";

const builder = createModelBuilder();
builder.appendNodes([0, 1, 2], [0, 0, 0, 1, 0, 0, 0, 1, 0]);
builder.openElementShapeBlock(ElementShape.Triangle);
builder.appendElements([100], [0, 1, 2]);
const model = builder.build();
const issues = validateModel(model);
if (issues.some((issue) => issue.severity === "error")) {
  throw new Error("Invalid host-supplied model");
}
const part = elementPart(70, createElementModelFromFemModel(model));
```

Node ids become dense render ordinals, while element ids remain authored. Pass
validated direct body ownership through the conversion options when available.
Use `createResultFieldFromModelResult` for host-supplied result payloads.
The [complete host integration example](https://github.com/dirkphilip/femgx/blob/main/examples/host-integration/README.md)
shows the same boundary with sparse/string host ids, repeated placements,
occurrence-specific results, selection, sectioning, and teardown.

## GLB display-scene input

{@link io/glb.importGlb} is published only from
`femgx/io/glb`. It preserves hierarchy, reusable triangle geometry, names, and
basic color/alpha metadata. It does not invent FE nodes or elements and does
not import external resources, textures, animation, lights, or units.

```ts
import { importGlb } from "femgx/io/glb";

const response = await fetch("/models/bracket.glb");
if (!response.ok) throw new Error(`GLB request failed: ${response.status}`);
const imported = await importGlb(new Uint8Array(await response.arrayBuffer()), {
  strict: true,
});
const viewport = await createViewport({ canvas, scene: imported.scene });
```

In non-strict mode inspect `imported.issues` and decide whether warnings are
acceptable before creating a viewport.

## Related pages

- [Scenes and finite-element models](scene-and-model.md)
- [Viewport lifecycle and interaction](viewport-interaction.md)
- [Runtime, camera, and WebGPU](runtime-and-platform.md)
- [GLB import contract](https://github.com/dirkphilip/femgx/blob/main/wiki/data/glb-import.md)
