# FemGx API reference

This is the workflow-first guide to the experimental FemGx 0.x API. The
generated pages below this introduction document every exported symbol, but
the examples here are the useful starting point: each one follows data from
authoring or import through a `Scene` and into one `Viewport`.

The package is intentionally WebGPU-only. A browser without a working WebGPU
device receives a typed unsupported result or error; there is no CPU renderer
or compatibility backend. The public API is also intentionally unstable in
0.x, so treat these examples as the current contract rather than a promise of
backwards compatibility.

## The mental model

FemGx has one authoritative data flow:

```text
Part definitions + assembly placements
                 ↓
               Scene
                 ↓
       createViewport({ canvas, scene })
                 ↓
       viewport.runtime + capability facades
```

There are four important ownership boundaries:

- A `Part` is immutable, reusable local geometry. It has no world transform.
- An assembly definition contains placements of parts or child assemblies.
  A placement contributes a transform and a stable placement identity; it does
  not copy geometry.
- A `Scene` is the authoritative registry of parts and assembly definitions,
  together with its root assembly and visibility state.
- `Viewport` owns the current compiled runtime, WebGPU resources, recovery,
  resize, and teardown. Stable `view`, `interaction`, `visibility`, `results`,
  and `presentation` facades expose the host-facing capabilities.

`SceneRuntime` is a read-only query facade over the compiled scene. It exposes
stable instance and assembly-occurrence handles, not renderer slots or GPU
buffers. The canonical live facade is `viewport.runtime`; reacquire that
property after `setScene()` or `updateScene()`, because structural replacement
installs a new runtime snapshot.

`Scene.visiblePartIds` and `Scene.visibleAssemblyIds` are the authored initial
visibility sets. `addPart` and `addAssembly` add new definitions to those sets
by default; the sets are read-only snapshots once `build()` returns. After a
scene enters a viewport, use `viewport.visibility.setPart` or
`viewport.visibility.setAssembly` for definition-wide live changes, and
`viewport.visibility.setInstance` or
`viewport.visibility.setAssemblyOccurrence` when only one expanded placement
should change.

### Composed viewport surface

Capability objects are stable non-owning views into the live viewport state:

```ts
viewport.view.camera;
viewport.interaction.state;
viewport.visibility.setPart(partId, false);
viewport.results.state;
viewport.presentation.setBackground("dark");

viewport.batch(() => {
  viewport.interaction.set(nextInteraction);
  viewport.visibility.setInstance(instanceId, true);
  viewport.presentation.setSectionPlane(plane);
});
```

The facades remain valid across scene replacement, resize, rendering, and
recovery. They fail consistently after `viewport.destroy()`. See the complete
[0.x viewport capability migration map](migration-0.x-viewport.md) for the
old-to-new member table.

Visibility ids are checked at the active scene/runtime boundary:

```ts
import { UnknownSceneIdentityError } from "femgx";

try {
  viewport.visibility.setInstance("stale-instance", false);
} catch (error) {
  if (error instanceof UnknownSceneIdentityError) {
    console.warn("Stale", error.kind, error.id);
  }
}
```

## Choose the entry point

Import the narrowest public entry point that owns the domain. This keeps the
ordinary rendering path small and makes ownership visible in application code.

| Entry            | Use                                                                               |
| ---------------- | --------------------------------------------------------------------------------- |
| `femgx`          | Parts, scenes, viewport lifecycle, interaction, picking, results, and common math |
| `femgx/model`    | FE elements, typed models, `elementPart`, `surfacePart`, shapes, faces, and edges |
| `femgx/io`       | Serializable FEM models, validation, diagnostics, and result conversion           |
| `femgx/io/glb`   | Self-contained GLB 2.0 display-scene import                                       |
| `femgx/camera`   | Camera construction, fitting, projection, coordinates, and custom controls        |
| `femgx/runtime`  | Intentional standalone CPU runtime inspection                                     |
| `femgx/platform` | Explicit supported-path WebGPU adapter/device ownership                           |

Do not import `importGlb` from `femgx`; it is deliberately published only from
`femgx/io/glb`. See the [0.x entry-point migration map](migration-0.x-entry-points.md)
when moving older code.

## Common browser setup

The viewport requires a real `HTMLCanvasElement`. In a browser application,
establish it from the host DOM rather than leaving a `canvas` variable implicit:

```html
<canvas id="femgx-viewport" style="width: 100%; height: 480px"></canvas>
```

```ts
const canvas = document.querySelector<HTMLCanvasElement>("#femgx-viewport");
if (canvas === null) throw new Error("Missing #femgx-viewport canvas");
```

The snippets that follow are complete within their stated context. They use
the same `canvas` binding above when showing a later stage of one workflow.

## Workflow 1: create a raw reusable `Part`

Use `createPart(id, input)` when the host already owns display geometry rather
than typed FE connectivity. The current input shape is plural:
`input.geometries` is a non-empty collection of homogeneous geometry groups.
Each group has `positions`, `indices`, and a `primitive` of `"triangles"`,
`"lines"`, or `"points"`.

```ts
import { createPart } from "femgx";

const trianglePart = createPart(10, {
  geometries: [
    {
      primitive: "triangles",
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      indices: new Uint32Array([0, 1, 2]),
    },
  ],
});
```

`id` is the part-definition identity in a scene. `createPart` validates array
lengths, finite coordinates, index bounds, and the part id, then derives local
bounds from the geometry. The returned part retains and owns the typed arrays;
do not mutate or reuse them after construction. Because a part is local and
immutable, the same definition can safely be referenced by many placements.

To render it, register the definition and a placement in an assembly. A scene
must have a registered root assembly:

```ts
import { createViewport, createScene, identity } from "femgx";

const scene = createScene()
  .addPart(trianglePart)
  .addAssembly({
    id: 20,
    name: "raw triangle model",
    placements: [
      {
        kind: "part",
        placementId: "triangle",
        partId: trianglePart.id,
        transform: identity(),
      },
    ],
  })
  .withRoot(20)
  .build();

const viewport = await createViewport({ canvas, scene });
// The viewport owns rendering and camera fitting from this point onward.
viewport.view.fit();
```

A raw part has no implicit FE element or node semantics. Consequently, it is
appropriate for generic display geometry. The optional metadata capabilities
are separate: part-level `elements` provide elemental identity and elemental
result mapping; node picking, nodal results, and deformation require
part-level `nodePositions` plus per-geometry `nodePickIds`; authored FE-edge
interaction requires per-geometry `edges`. For typed FE data, use the next
workflow so `elementPart` supplies these mappings consistently.

## Workflow 2: author typed FE data and render it

`femgx/model` is the FE authoring boundary. Node ids are dense (`0` through
`nodeCount - 1`) and each element uses the canonical node order of its shape.
`createElement` validates connectivity; `createElementModel` validates the
model as a whole and owns a `Float32Array` copy of the node coordinates.

This small two-triangle model is concrete enough to run and demonstrates the
full `ElementModel → elementPart → Scene → Viewport` path:

```ts
import { createViewport, createScene, identity } from "femgx";
import { ElementShape, createElement, createElementModel, elementPart } from "femgx/model";

const nodes = new Float32Array([
  0,
  0,
  0, // node 0
  1,
  0,
  0, // node 1
  1,
  1,
  0, // node 2
  0,
  1,
  0, // node 3
]);
const elements = [
  createElement(100, ElementShape.Triangle, [0, 1, 2]),
  createElement(101, ElementShape.Triangle, [0, 2, 3]),
];
const model = createElementModel(nodes, elements);
const part = elementPart(30, model);

const scene = createScene()
  .addPart(part)
  .addAssembly({
    id: 40,
    name: "typed plate",
    placements: [{ kind: "part", partId: part.id, transform: identity() }],
  })
  .withRoot(40)
  .build();

const viewport = await createViewport({ canvas, scene });
```

`elementPart` compiles a heterogeneous model into homogeneous primitive groups
while retaining one semantic element table at part level. The tessellated
triangles are renderer data; element ids `100` and `101` remain the stable
identities used by element picking, selection, and elemental result fields.
This split is why the host authors FE semantics once and does not manually
maintain renderer triangles.

Bodies and blocks are optional model metadata. A block-defined body aggregates
blocks, while a body with direct `elementIds` owns those elements directly; a
body cannot mix both forms. For example:

```ts
const modelWithOwnership = createElementModel(nodes, elements, {
  blocks: [
    { id: 7, name: "left half", elementIds: [100] },
    { id: 8, name: "right half", elementIds: [101] },
  ],
  bodies: [{ id: 9, name: "plate", blockIds: [7, 8] }],
});
const ownedPart = elementPart(30, modelWithOwnership);
```

Keep the source model and part local to the application. The part owns the
compiled arrays after `elementPart`; the viewport owns only the derived runtime
and GPU state.

## Workflow 3: reuse one definition through assemblies

A part definition, placement, assembly definition, and expanded runtime
instance are different concepts:

```text
part id 30       = one reusable local geometry definition
placementId      = one authored reference within an assembly
instanceId       = one expanded placed-part identity in the runtime
occurrenceId     = one expanded assembly node in the runtime
```

The distinction matters when the same definition appears in different places:
the geometry and `partId` are shared, while transforms, visibility, selection,
and picking are occurrence-specific. Give placements explicit ids when a host
will update or reconcile them; otherwise the validated sibling index is used
as a deterministic fallback.

The following places a reusable bracket assembly twice under one root. The
second placement changes only the parent transform; it does not duplicate the
part geometry:

```ts
import { createViewport, createScene, rotationZ, translation } from "femgx";

const bracketAssembly = {
  id: 50,
  name: "bracket",
  placements: [
    {
      kind: "part" as const,
      placementId: "bracket-body",
      partId: ownedPart.id,
      transform: translation(0, 0, 0),
    },
  ],
};

const scene = createScene()
  .addPart(ownedPart)
  .addAssembly(bracketAssembly)
  .addAssembly({
    id: 60,
    name: "root",
    placements: [
      {
        kind: "assembly",
        placementId: "left-bracket",
        assemblyId: bracketAssembly.id,
        transform: translation(-2, 0, 0),
      },
      {
        kind: "assembly",
        placementId: "rotated-bracket",
        assemblyId: bracketAssembly.id,
        transform: rotationZ(Math.PI / 2),
      },
    ],
  })
  .withRoot(60)
  .build();

const viewport = await createViewport({ canvas, scene });
```

The nested assembly transform is relative to its owning assembly. The runtime
expands the hierarchy and composes transforms, while the renderer batches by
part. Host code should use stable runtime handles for occurrence-specific
actions, never private slots:

```ts
for (const instance of viewport.runtime.getInstances()) {
  console.log(instance.instanceId, instance.partId, instance.transform);
}

const [firstInstance] = viewport.runtime.getInstanceIds();
if (firstInstance !== undefined) {
  viewport.visibility.setInstance(firstInstance, false);
}
```

`viewport.visibility.setPart(partId, false)` hides every occurrence of a
definition; `viewport.visibility.setInstance(instanceId, false)` hides one
placement. Similarly, `setAssembly` affects an assembly definition, while
`setAssemblyOccurrence` affects one expanded occurrence. An unknown id throws
`UnknownSceneIdentityError` before any runtime or renderer mutation.

## Workflow 4: viewport lifecycle, picking, and structural updates

`createViewport` is the one supported rendering lifecycle. It requests a
WebGPU device, creates the fitted camera and standard controls, synchronizes
canvas resizing, and submits frames. The host owns DOM event wiring and decides
what a physical hit means for its UI.

### Opt into default hover, click, and box selection

Hosts that want the ordinary interaction policy can install one explicit,
disposable binding around the existing viewport primitives:

```ts
import { installViewportInteraction } from "femgx";

const disposeInteraction = installViewportInteraction({
  viewport,
  canvas,
  granularity: () => "element",
  onError: (error, phase) => {
    console.error(`Viewport ${phase} interaction failed`, error);
  },
});

// Plain clicks replace selection; Control/Meta clicks toggle it.
// Hover replaces the one hovered target. Box selection uses pickRegion.

const disposeViewport = (): void => {
  disposeInteraction();
  viewport.destroy();
};
```

The installer has an explicit disposer and adds point listeners only to the
provided canvas; its composed box lifecycle also listens for Escape to cancel
an active drag. Touch remains routed to camera navigation unless `touchMode`
returns `"hover"` or `"box-select"`. A host can replace region discovery with
an authoritative through-query and still receive the computed frustum and
resolved candidates:

```ts
const disposeInteraction = installViewportInteraction({
  viewport,
  canvas,
  granularity: () => "element",
  resolveRegion: ({ event, frustum, granularity }) =>
    hostThroughQuery({ rect: event.rect, frustum, granularity }),
  onBoxSelection: ({ event, frustum, targets }) => {
    console.log("completed box", event.rect, frustum, targets);
  },
  // Return undefined here to suppress the default mutation, or return a
  // host-authored InteractionState to replace it.
  applyInteraction: ({ defaultInteraction }) => defaultInteraction,
});
```

The generated member reference uses the same target-state recipe for custom
bindings:

```text
point pick → interactionTargetFromHit → setTargetHovered / setTargetHighlighted
           → viewport.interaction.set
point click → interactionTargetFromHit → setTargetSelected → viewport.interaction.set
box complete → interaction.pickRegion(rect) OR boxSelectionFrustum(view.camera, rect)
             + Through query → setTargetsSelected → viewport.interaction.set
```

`setTargetsSelected` and `setTargetsHighlighted` perform one duplicate-safe
immutable transition across mixed target kinds. `Viewport.batch` is different:
it coalesces viewport invalidation and visibility synchronization around several
synchronous viewport calls; it does not make several interaction helper calls
into one immutable state transition.

Candidate resolvers are generation-safe: results from an older pointer,
gesture, viewport, or policy are discarded. The installer keeps box selection
renderer-independent and adds no GPU pass or readback path beyond the
viewport's existing `interaction.pick` and `interaction.pickRegion` operations.

Here is a complete click-to-select loop. `pick` returns physical information;
`interactionTargetFromHit` maps it to a stable host-facing identity, and the
immutable interaction transition is installed with `viewport.interaction.set`. The
handlers are named because they belong to the host and must be removable. A
monotonic request number drops stale hover results when pointer moves outpace
GPU readbacks:

```ts
import { interactionTargetFromHit, setTargetHovered, setTargetSelected } from "femgx";

let disposed = false;
let hoverRequest = 0;
const handlePointerMove = (event: PointerEvent): void => {
  const request = ++hoverRequest;
  const bounds = canvas.getBoundingClientRect();
  void viewport.interaction.pick(event.clientX - bounds.left, event.clientY - bounds.top).then(
    (hit) => {
      if (disposed || request !== hoverRequest) return;
      const target = hit === undefined ? undefined : interactionTargetFromHit(hit, "element");
      viewport.interaction.set(setTargetHovered(viewport.interaction.state, target));
    },
    () => {
      // A pending pick may reject while the viewport is being destroyed.
    },
  );
};

const handleClick = (event: MouseEvent): void => {
  const bounds = canvas.getBoundingClientRect();
  void viewport.interaction.pick(event.clientX - bounds.left, event.clientY - bounds.top).then(
    (hit) => {
      if (disposed || hit === undefined) return;
      const target =
        interactionTargetFromHit(hit, "element") ?? interactionTargetFromHit(hit, "instance");
      if (target !== undefined) {
        viewport.interaction.set(setTargetSelected(viewport.interaction.state, target, true));
      }
    },
    () => {
      // A pending pick may reject while the viewport is being destroyed.
    },
  );
};

canvas.addEventListener("pointermove", handlePointerMove);
canvas.addEventListener("click", handleClick);

const disposeViewport = (): void => {
  disposed = true;
  canvas.removeEventListener("pointermove", handlePointerMove);
  canvas.removeEventListener("click", handleClick);
  viewport.destroy();
};
```

For a rectangular visible-region selection, call `pickRegion` with a CSS-space
rectangle and a granularity such as `"element"`. It returns interaction targets
without mutating selection; the host can replace the selection in one state
transition with `setTargetsSelected`.

```ts
import { clearSelection, setTargetsSelected } from "femgx";

const targets = await viewport.interaction.pickRegion(
  { left: 20, top: 20, right: 320, bottom: 240 },
  "element",
);
const nextInteraction = setTargetsSelected(
  clearSelection(viewport.interaction.state),
  targets,
  true,
);
viewport.interaction.set(nextInteraction);
```

`pickRegion` is nearest-visible raster discovery. For the Core-now Through
strategy, use `boxSelectionFrustum` with the authoritative placed FE geometry
in the host; it is an element-only CPU query and intentionally does not apply
raster occlusion. Tessellation diagonals are never authored edge identities.

Structural changes are transactional. Build a new immutable scene, call
`updateScene`, then reacquire the live runtime facade:

```ts
const nextScene = createScene()
  .addPart(ownedPart)
  .addAssembly({
    id: 60,
    name: "root",
    placements: [
      {
        kind: "part",
        placementId: "replacement",
        partId: ownedPart.id,
        transform: translation(0, 0, 0),
      },
    ],
  })
  .withRoot(60)
  .build();

const outcome = viewport.updateScene(nextScene);
console.log(outcome.results); // "none", "preserved", or "cleared"
const currentRuntime = viewport.runtime; // new facade after the replacement
```

`updateScene` recompiles before committing, preserves compatible placement
state, prunes stale interaction references, and revalidates active results.
Use `setScene` when a full replacement and reset of placement-scoped state is
what the application wants. When the host removes the viewport, call
`disposeViewport` (or the equivalent teardown in the host framework): the host
removes listeners it installed, then `viewport.destroy()` releases the
viewport-owned renderer resources, controls, resize listener, and other
library listeners.

## Workflow 5: authored scalar results and nodal deformation

Results are authored snapshots, not a solver or timeline. A scalar field has
one value per node or element; a nodal vector field supplies displacement. The
field values are index-aligned to the owning model and `NaN` means missing.
FemGx does not derive stress, convert units, interpolate time, or retain a
sequence of cases.

For the two-triangle model from Workflow 2, this snapshot colors nodes by an
authored scalar and deforms the same nodes with an authored displacement:

```ts
import { createResultField, scalarRange } from "femgx";

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

A result field is validated for its location, shape, count, unit, and exact
typed-array length. Before replacing the previous snapshot, the viewport
checks structural coverage: `count` must address every node or element id that
the rendered scene references. Structural coverage is separate from authored
data completeness: `NaN` is an allowed missing value, including for a rendered
entity, and is not treated as zero. One `viewport.results.set` call is atomic across
scalar, deformation, and optional orientation roles. To show a host-owned
sequence, call `viewport.results.set` again with the next complete snapshot; FemGx retains
only the current one.

Elemental scalar coloring uses element ids rather than tessellated triangle
indices:

```ts
const stressValues = new Float32Array(102).fill(Number.NaN);
stressValues[100] = 12.5;
stressValues[101] = 18.0;
const stress = createResultField({
  id: "stress-step-1",
  name: "Von Mises stress",
  location: "elemental",
  shape: "scalar",
  count: 102,
  unit: "MPa",
  values: stressValues,
});
viewport.results.set({ scalar: { field: stress } });
```

The dense id contract allows one field to address mixed primitive groups
without exposing private GPU pick ids. `count` must cover the highest rendered
element id (`count` is therefore greater than that id), but the value at a
rendered element id may still be `NaN` when the authored result is missing.
Other entries may also remain `NaN`; range calculation and scalar presentation
preserve that missing-value meaning.

Bounded authored elemental orientation is available when the host has one
three-component vector per rendered element:

```ts
const directionValues = new Float32Array(102 * 3);
for (const elementId of [100, 101]) {
  directionValues[elementId * 3] = 1;
}
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
  scalar: { field: temperature },
  vectors: {
    field: directions,
    glyph: "arrow",
    transform: "direction",
    lengthScale: 0.25,
    widthPixels: 2,
  },
});
```

The vector role is deliberately bounded: authored elemental data only,
`"arrow"` or `"axis"`, and `"direction"` or `"normal"` transforms. FemGx
does not compute engineering vectors, magnitudes, tensor glyphs, legends, or
playback controls.

## Workflow 6: ingest a host-supplied FE model

`femgx/io` provides a serializable `FemModel` staging boundary for hosts that
already own model ingestion. Validate the payload, convert it once to the typed
render model, compile a part, and follow the normal scene path:

```ts
import { createViewport, createScene, identity } from "femgx";
import { createElementModelFromFemModel, createModelBuilder, validateModel } from "femgx/io";
import { ElementShape, elementPart } from "femgx/model";

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
const scene = createScene()
  .addPart(part)
  .addAssembly({
    id: 71,
    name: "host model",
    placements: [{ kind: "part", partId: part.id, transform: identity() }],
  })
  .withRoot(71)
  .build();
const viewport = await createViewport({ canvas, scene });
```

Node ids must be dense and in coordinate order for the conversion. Element ids
remain authored identities, and the conversion creates dense single-precision
coordinates for rendering. Host-supplied result fields can be converted with
`createResultFieldFromModelResult` before calling `viewport.results.set()`.

## Workflow 7: import a GLB display scene

`femgx/io/glb` imports self-contained GLB 2.0 bytes into the same canonical
`Scene`/`Part`/`Viewport` concepts. It preserves hierarchy, reusable
tessellated triangle geometry, names, and basic color/alpha metadata. It does
not create FE nodes or elements and does not import external resources,
textures, PBR features, animation, lights, or units.

```ts
import { createViewport } from "femgx";
import { importGlb } from "femgx/io/glb";

const response = await fetch("/models/bracket.glb");
if (!response.ok) throw new Error(`GLB request failed: ${response.status}`);
const glbBytes = new Uint8Array(await response.arrayBuffer());
const imported = await importGlb(glbBytes, { strict: true });
const viewport = await createViewport({ canvas, scene: imported.scene });

for (const [partId, name] of imported.partNames) {
  console.log("Imported part", partId, name, imported.partStyles.get(partId));
}
```

The importer makes a synthetic root assembly and maps reachable glTF nodes to
named assembly definitions. Repeated mesh use remains reusable part geometry;
node transforms become placement transforms. `strict: true` rejects a
recoverable diagnostic as well as fatal malformed input. In non-strict mode,
inspect `imported.issues` and decide whether warnings are acceptable before
creating the viewport.

## Results, runtime, and ownership after scene changes

The viewport's properties are intentionally narrow:

```ts
console.log(viewport.scene); // authoritative current Scene
console.log(viewport.runtime); // current stable query facade
console.log(viewport.view.camera); // current immutable camera value
console.log(viewport.interaction.state); // current immutable interaction state
console.log(viewport.results.state); // current resolved authored snapshot
console.log(viewport.presentation.sectionPlane); // current clipping plane
```

For a CPU-only inspection with no canvas or GPU, use the separate runtime entry:

```ts
import { createSceneRuntime } from "femgx/runtime";

const snapshot = createSceneRuntime(scene);
console.log(snapshot.getVisibleInstanceIds());
console.log(snapshot.getOccurrences());
```

This is useful for host-side inspection or queries before a viewport exists,
but it is not a second rendering lifecycle. Live visibility changes belong to
`Viewport`; runtime arrays, packed slots, draw batches, and GPU record
layouts are implementation details.

## Camera and resize ownership

The default viewport creates a fitted camera and installs standard controls on
the supplied canvas. Hosts that need custom camera state can use `femgx/camera`
and pass the resulting immutable `Camera` to `createViewport`:

```ts
import { createViewport } from "femgx";
import { createCamera, setProjection } from "femgx/camera";

const camera = setProjection(createCamera({ width: 800, height: 480 }), "perspective");
const viewport = await createViewport({ canvas, scene, camera });
viewport.view.setCamera(camera, { durationMs: 250 });
```

When the host changes the canvas layout, call `viewport.resize()` after the
new CSS size is applied. `view.fit` and `view.fitSelection` use the viewport's one
interruptible transition path; a positive finite `durationMs` animates and a
zero or omitted duration applies immediately. A host may provide
`keyboardTarget` to opt into the core `Z` fit-selection shortcut; FemGx does
not install an implicit global keyboard listener.

## WebGPU support and recovery

Use the non-throwing probe when a host wants to gate UI before loading a model:

```ts
import { queryWebGpuSupport } from "femgx";

const support = await queryWebGpuSupport({ powerPreference: "high-performance" });
if (support.status !== "supported") {
  document.querySelector("#status")!.textContent = support.message;
  // Offer a WebGPU-capable browser/device; there is no CPU rendering fallback.
} else {
  console.log(support.adapter);
}
```

`createViewport` performs the device request itself. If that request cannot
produce a working device, it rejects with `WebGpuUnsupportedError` carrying a
typed reason (`"no-webgpu"`, `"adapter-unavailable"`, or
`"device-unavailable"`). A supported-path device loss can be reported with
`onDeviceLost`; the viewport can attempt recovery with `await viewport.recover()`
and reports success through `onRecovered`. Recovery retains the current scene
and latest authored snapshot; it is device recovery, not a renderer fallback.

## What is intentionally not in this API

The reference does not promise a CPU/2D renderer, a generalized geometry query
subsystem, a femgx-owned result timeline or playback controller, derived
engineering quantities, a public legend system, broad interchange adapters,
GLB FE semantics, or renderer slot/buffer access. Those boundaries are part of
the product contract and are why the public workflow stays composable:
applications own model/result sequencing and UI policy, while FemGx owns
validated scene compilation and the WebGPU viewport lifecycle.

The generated navigation remains the searchable symbol index, grouped by:

- Scene and geometry
- Elements and model editing
- Viewport lifecycle
- Interaction and picking
- Results
- Import and export
- Camera and math
- Advanced runtime and WebGPU platform

Use the **Demo** link in the generated documentation header to see the live
workbench, and return here when you need the reasoning behind the API shape.
