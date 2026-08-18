# Core API review

This is the compact review sheet for femgx's supported public API. It shows
the canonical user path, ownership boundaries, and the small set of types that
should be considered before adding a new public concept. The explicit facades
under `src/entries/` and the public-entry inventory test are the exhaustive
symbol authority.

The current contract is the WebGPU-only product described in
[[requirements/product-scope|Product scope]]. The authoritative CPU scene owns
model data; the viewport owns compiled runtime and renderer state.

## The canonical path

```text
Geometry / Part definitions
            ↓
Assembly placements
            ↓
          Scene
            ↓
   createViewport({ canvas, scene })
            ↓
     runtime + camera + WebGPU renderer
```

The default application should define reusable geometry, register it in one
scene, create one or more independent viewports as needed, and drive
visibility/interaction/results through those viewport owners. Geometry is
uploaded once per part per renderer/viewport and reused across placement
instances within that renderer; the CPU `Part` data may be shared across
scenes and viewports. An application may share the authoritative scene and
interaction state without introducing a public viewport manager, shared
runtime, or renderer pool.

## Minimal example

```ts
import { createPart, createViewport, createScene, identity, type Geometry } from "femgx";
import {
  createInteractionState,
  setPartOccurrenceOverride,
  setPartOccurrenceOverrides,
  setPartOverride,
} from "femgx/interaction";

const geometry: Geometry = {
  positions,
  indices,
};
const part = createPart(1, { geometries: [geometry], elements });

const scene = createScene()
  .addPart(part)
  .addAssembly({
    id: 1,
    name: "root",
    placements: [{ kind: "part", partId: part.id, transform: identity() }],
  })
  .withRoot(1)
  .build();

const viewport = await createViewport({
  canvas,
  scene,
  pointSizePixels: 8,
  nodeSizePixels: 6,
});

let interaction = createInteractionState();
interaction = setPartOverride(interaction, part.id, {
  color: { r: 0.2, g: 0.6, b: 0.95, a: 1 },
});
interaction = setPartOccurrenceOverride(interaction, "1/0", {
  lineWidthPixels: 3,
});
interaction = setPartOccurrenceOverrides(interaction, [
  ["1/0", { color: { r: 0.2, g: 0.7, b: 0.4, a: 1 } }],
]);
viewport.interaction.set(interaction);
viewport.visibility.setPart(part.id, false);
viewport.results.clear();
viewport.destroy();
```

`createPart` retains the supplied typed arrays without defensive copies and
takes ownership of them; callers must not mutate or reuse them afterward.
`input.elements` is optional; when present, each primitive belongs to exactly
one range qualified by its primitive group and can participate in element
picking and interaction. Semantic node and optional body tables are likewise
part-level inputs rather than geometry fields. Omitting bodies must not create
a model-scaled ownership table or renderer resource.
`pointSizePixels` and `nodeSizePixels` are independent screen-space diameters
in CSS pixels. They default to 8 and 6, accept values in `[1,64]`, and can be
changed later with `viewport.presentation.setPointSizePixels` and
`viewport.presentation.setNodeSizePixels`.

`StyleOverride.lineWidthPixels` controls authored `Line` and `Line3` elements
in CSS pixels. It is valid on part and part-occurrence overrides, where the
part-occurrence style wins, defaults to 2, and accepts `[0.5,64]`. Body, element, face, node,
and theme overrides intentionally do not accept line width; non-line geometry
ignores it. Authored lines are expanded once into reusable triangle geometry,
while renderer-owned edge helpers retain their separate line-list path.

## Core vocabulary and owners

| Area        | Core API                                                                                                                                                                                                                                                                     | Owns                                                                                                                                                                                                                              |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Geometry    | `Geometry`, `Part`, `createPart`, `GeometryBody`, `FaceSubset`, `femgx/model: surfacePart`                                                                                                                                                                                   | Validated immutable local positions, mixed compact surface topology, indices, derived body/element/node/face metadata, and local bounds. Focused validators and raw bound calculation are implementation helpers.                 |
| Elements    | `femgx/model`: `createElement`, `ElementModel`, `Body`, `createElementModel`, `elementPart`, `boundaryFaceRefs`, `FaceIdRef`, `ElementShape`                                                                                                                                 | Validated FE connectivity (Point, Line, Line3, Triangle, Tri6, Quad, Quad8, Tet4, Tet10, Wedge6, Pyramid5, Hex8, Hex20), optional direct body ownership, canonical topology, mixed primitive grouping, and face selection inputs. |
| Assemblies  | `AssemblyDefinition`, `PartPlacement`, `AssemblyPlacement`                                                                                                                                                                                                                   | Reusable hierarchical placement definitions and local transforms.                                                                                                                                                                 |
| Scene       | `createScene`, `SceneBuilder`, `Scene`                                                                                                                                                                                                                                       | Authoritative part/assembly registries, root identity, and authoring visibility state.                                                                                                                                            |
| Viewport    | `createViewport`, `Viewport`, `ViewportOptions`, `ViewportView`, `ViewportInteraction`, `ViewportVisibility`, `ViewportResults`, `ViewportPresentation`                                                                                                                      | Runtime compilation, one lifecycle owner, stable capability facades, WebGPU renderer, controls, resize, recovery, and teardown.                                                                                                   |
| Interaction | `createInteractionState`, `InteractionTarget`, `setTargetSelected`, `setTargetHighlighted`, `setTargetHovered`, `isTargetSelected`, `isTargetHighlighted`, `isHoveredTarget`, `clearSelection`, `setPartOverride`, `setPartOccurrenceOverride`, `setPartOccurrenceOverrides` | Opaque immutable selection, highlight, and single-hover state. Body visibility and explicit part/part-occurrence style overrides remain separate target-scoped layers; occurrence style is more specific than part style.         |
| Camera      | `femgx/camera`: `createCamera`, `setProjection`, `orbitCamera`, `panCamera`, `zoomCamera`, `fitCamera`                                                                                                                                                                       | Immutable camera values and projection/navigation math.                                                                                                                                                                           |
| Picking     | `ViewportInteraction.pick`, `PickHit`, `interactionTargetFromHit`, `InteractionGranularity`                                                                                                                                                                                  | One complete side-effect-free GPU hit plus explicit host-owned interaction-target conversion.                                                                                                                                     |
| Results     | `createResultField`, `ViewportResultsConfig`                                                                                                                                                                                                                                 | Authored nodal/elemental scalar values, ranges, maps, and optional nodal deformation configuration.                                                                                                                               |
| IO          | `femgx/io`: `createModelBuilder`, `validateModel`, `createElementModelFromFemModel`, `createResultFieldFromModelResult`                                                                                                                                                      | Host-supplied serializable model staging, diagnostics, and narrow conversion into authored viewport result fields.                                                                                                                |
| Platform    | `femgx/platform`: `queryWebGpuSupport`, `WebGpuUnsupportedError`, `requestWebGpuDevice`                                                                                                                                                                                      | Capability probing, typed unsupported results, device creation, and loss information.                                                                                                                                             |

## Ownership and identity rules

- A `Part` is reusable local geometry constructed by `createPart`. It does not
  own a world transform, and callers cannot provide a separate bounds value.
- A placement references a part or assembly definition; it does not copy
  geometry.
- `PartId` and `AssemblyId` identify registry definitions within a scene.
- `PartOccurrenceId` identifies a placement occurrence and remains stable when
  visibility or draw-order compaction changes.
- `AssemblyOccurrenceId` identifies one expanded assembly occurrence, including
  repeated placements of the same assembly definition.
- `ElementId` is part-local. An oriented face is identified by its
  `(elementId, faceIndex)` pair; `FaceKey` remains the canonical adjacency
  identity and is not a substitute for orientation. `NodeId` is model-local.
- `BodyId` is a model-local one-based identity. An optional body groups direct,
  non-overlapping element membership. Body interaction state remains scoped by
  the placement `PartOccurrenceId`. Semantic element blocks are removed from the
  product and must not survive as compatibility identities or serialized fields.
- `Scene` is the authoring source of truth. `SceneRuntime`, typed arrays, draw
  orders, GPU buffers, and batch records are derived representations. Public
  runtime transforms and collections are defensive snapshots; visible handles
  are named `getVisiblePartOccurrenceIds()` and use deterministic runtime order.
- `Viewport` is the public owner of the current live `SceneRuntime` facade
  and the internal WebGPU renderer; hosts should reacquire `viewport.runtime`
  after `replaceScene` or `reconcileScene` and never manually synchronize packed
  runtime state.

For host-supplied data, `createElementModelFromFemModel` is the validated
conversion from the serializable `FemModel` into the dense `ElementModel`
consumed by element tessellation. Hosts then call
`elementPart` once and register the returned semantic part in an `Assembly`;
its homogeneous primitive groups remain internal draw partitions, not
additional authoring identities. A selected `ModelResultField` enters the authored
results path through `createResultFieldFromModelResult` before
`ViewportResults.set()`.

## Viewport surface

### Lifecycle and scene

| Method                                  | Purpose                                                                                                                                                                                      |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `reconcileScene(scene)`                 | Apply a structural scene update atomically, preserve the camera and surviving placement state, prune invalid nested references, and report whether active results were preserved or cleared. |
| `replaceScene(scene)`                   | Replace the authoritative scene and rebuild the derived runtime, clearing active results.                                                                                                    |
| `view.setCamera(camera)` / `view.fit()` | Set or fit the immutable camera value; `fitContentInset` can keep host overlays outside the fitted rectangle.                                                                                |
| `resize()`                              | Match WebGPU render size to the canvas and device pixel ratio.                                                                                                                               |
| `invalidate()` / `render()`             | Schedule or perform a render of the current state.                                                                                                                                           |
| `batch(operation)`                      | Coalesce synchronous mutations into one invalidation and render.                                                                                                                             |
| `recover()`                             | Recreate supported WebGPU resources after device loss.                                                                                                                                       |
| `destroy()`                             | Release renderer, resize, and camera-control resources.                                                                                                                                      |

### Visibility and interaction

`viewport.visibility.setPart`, `setAssemblyOccurrence`, `setAssembly`, and
`setPartOccurrence` update the viewport-owned derived runtime using stable part,
assembly, and placement handles, then synchronize only affected instance records.
Style,
selection, highlight, and hover changes are expressed as a new opaque
`InteractionState` and installed with `interaction.set`. Use target-level
operations for all six supported target kinds; query helpers provide state
without exposing the internal collections. Body visibility and explicit style
overrides remain separate, placement-scoped layers.

When result visualization is active, `viewport.interaction.state` remains the exact
host-owned value passed to `viewport.interaction.set`. The viewport derives dense
per-part scalar tables for the renderer, independently of interaction state;
hosts never receive or need to round-trip generated element overrides.

`reconcileScene` is the live-edit boundary for a scene whose part definitions or
placements changed. Stable placement ids retain visibility and surviving
placement-scoped interaction state; body, element, face, and node references
that no longer exist are removed. The active authored result
configuration is revalidated against the replacement scene and the returned
`SceneReconciliationOutcome` reports whether it remained usable. `replaceScene` remains the
explicit full-replacement path and clears results.

Interaction state is immutable and opaque. It stores at most one hovered target;
setting a new hover replaces the previous target. Part and instance state establish
the base style; body state adds placement-scoped visibility and emphasis; element,
face, and node state provide more specific emphasis; explicit overrides are
resolved by the existing style resolvers. The renderer receives GPU attributes
rather than CPU material clones.

### Picking

```ts
const hit = await viewport.interaction.pick(x, y);
if (hit?.kind === "face") {
  console.log(hit.partId, hit.partOccurrenceId, hit.key, hit.normal, hit.worldPosition);
}
const target = hit === undefined ? undefined : interactionTargetFromHit(hit, "face");
```

`pick` returns one deepest `PickHit` or `undefined`, including the exact displayed
world point reconstructed from the same GPU depth readback. Element, face, and node
hits include the owning `bodyId` when the geometry provides one. Hosts choose a
selection identity separately with `interactionTargetFromHit`; unsupported requests
return `undefined` and body identity is never guessed. There is no multi-hit pick-list
API in the current contract.

### Authored results and snapshot sequencing

Result fields are typed by location (`"nodal"` or `"elemental"`). Viewport
results accept authored scalar fields; authored nodal vector fields remain the
separate deformation input. Missing scalar values are `NaN` and map to the
configured missing color.

```ts
const stress = createResultField({
  id: "stress",
  name: "Authored stress",
  location: "elemental",
  shape: "scalar",
  count: elementCount,
  unit: "MPa",
  values: authoredScalarValues,
});

viewport.results.set({
  scalar: { field: stress },
  deformation: { field: displacement, scale: 1.5 },
  orientation: { field: directions, glyph: "arrow", transform: "normal", widthPixels: 2 },
});

viewport.results.clear();
```

`ViewportResultsConfig` represents one authored snapshot with scalar fields at
nodal or elemental locations, explicit or observed ranges, scalar color maps,
optional nodal deformation, and an optional elemental orientation vector role. The
non-empty role set is resolved atomically: invalid combinations leave the
previous result state and renderer state unchanged. Hosts may sequence exact
authored snapshots through repeated `results.set()` calls; snapshot collections,
time metadata, scheduling, controls, and playback rate remain host-owned.
Derived engineering quantities, tensor glyphs, temporal interpolation, and a
public legend subsystem remain outside the core API. Element anchors, packed
records, and GPU resources are internal.
See [[data/vector-field-visualization|Authored elemental orientation visualization]].

## Additional supported APIs

These exports are supported utilities around the canonical viewport path:

- `femgx/runtime`: `createSceneRuntime` / `SceneRuntime` for hosts that intentionally own
  runtime compilation and stable-handle queries.
- `femgx/camera`: `installCameraControls` and the lower-level camera math for custom viewport
  shells.
- `interactionTargetFromHit` for pure host-side selection policy.

The low-level WebGPU renderer is internal to `Viewport` and is not exported
from the package root. A custom renderer lifecycle requires a separate product
decision and stable public ownership contract.

Advanced APIs must not become a reason to expose runtime slots, GPU record
layouts, storage capacities, or parallel renderer abstractions as new default
concepts.

## Review checklist for API changes

Before adding a public symbol, confirm:

1. It has one clear owning subsystem and data owner.
2. Its identity is stable through scene compilation, instancing, and picking.
3. It fits the `Part → Assembly → Scene → Viewport` flow.
4. It has the smallest behavior that delivers concrete user value.
5. Existing abstractions can be extended or simplified before a new one is
   introduced.
6. The API example, unit/e2e coverage, package smoke test, and relevant wiki
   note can all describe the same contract.

Related: [[architecture/api-design|API design north star]],
[[architecture/demo-library-boundary|Demo / library boundary]],
[[rendering/platform-support|WebGPU platform support]].

[architecture/api-design|API design north star]: api-design.md
[architecture/demo-library-boundary|Demo / library boundary]: demo-library-boundary.md
[rendering/platform-support|WebGPU platform support]: ../rendering/platform-support.md
[requirements/product-scope|Product scope]: ../requirements/product-scope.md
[data/vector-field-visualization|Authored elemental orientation visualization]: ../data/vector-field-visualization.md
