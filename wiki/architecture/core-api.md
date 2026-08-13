# Core API review

This is the compact review sheet for femgx's supported public API. It shows
the canonical user path, ownership boundaries, and the small set of types that
should be considered before adding a new public concept. It is intentionally
smaller than the exhaustive [[architecture/public-api-audit|public API audit]].

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
   createFemViewport({ canvas, scene })
            ↓
     runtime + camera + WebGPU renderer
```

The default application should define reusable geometry, register it in one
scene, create one or more independent viewports as needed, and drive
visibility/interaction/results through those viewport owners. Geometry is
uploaded once per part and reused across placement instances; an application
may share the authoritative scene and interaction state without introducing a
public viewport manager, shared runtime, or renderer pool.

## Minimal example

```ts
import {
  createPart,
  createFemViewport,
  createInteractionState,
  createScene,
  identity,
  setPartOverride,
  type Geometry,
} from "femgx";

const geometry: Geometry = {
  positions,
  indices,
  elements,
};
const part = createPart(1, geometry);

const scene = createScene()
  .addPart(part)
  .addAssembly({
    id: 1,
    name: "root",
    placements: [{ kind: "part", partId: part.id, transform: identity() }],
  })
  .withRoot(1)
  .build();

const viewport = await createFemViewport({
  canvas,
  scene,
  pointSizePixels: 8,
  nodeSizePixels: 6,
});

let interaction = createInteractionState();
interaction = setPartOverride(interaction, part.id, {
  color: { r: 0.2, g: 0.6, b: 0.95, a: 1 },
});
viewport.setInteraction(interaction);
viewport.setPartVisible(part.id, false);
viewport.clearResults();
viewport.destroy();
```

`createPart` retains the supplied typed arrays without defensive copies and
takes ownership of them; callers must not mutate or reuse them afterward.
`elements` is optional; when present, each triangle belongs to exactly one
stable element range and can participate in element picking and interaction.
`pointSizePixels` and `nodeSizePixels` are independent screen-space diameters
in CSS pixels. They default to 8 and 6, accept values in `[1,64]`, and can be
changed later with `viewport.setPointSizePixels` and
`viewport.setNodeSizePixels`.

## Core vocabulary and owners

| Area        | Core API                                                                                                                                                                                                        | Owns                                                                                                                                                                                       |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Geometry    | `Geometry`, `Part`, `createPart`, `Body`, `FaceSubset`, `polygonGeometry`, `polygonPart`                                                                                                                        | Validated immutable local positions, indices, optional body/element/node/face metadata, and derived local bounds. Focused validators and raw bound calculation are implementation helpers. |
| Elements    | `createElement`, `ElementModel`, `heterogeneousElementParts`, `boundaryFaceRefs`, `FaceIdRef`, `ElementShape`                                                                                                   | Validated FE connectivity (Point, Line, Line3, Triangle, Tri6, Quad, Quad8, Tet4, Tet10, Hex8, Hex20), canonical topology, mixed primitive grouping, and face selection inputs.            |
| Assemblies  | `NamedAssembly`, `PartPlacement`, `SubAssemblyPlacement`                                                                                                                                                        | Reusable hierarchical placement definitions and local transforms.                                                                                                                          |
| Scene       | `createScene`, `SceneBuilder`, `Scene`                                                                                                                                                                          | Authoritative part/assembly registries, root identity, and authoring visibility state.                                                                                                     |
| Viewport    | `createFemViewport`, `FemViewport`, `FemViewportOptions`                                                                                                                                                        | Runtime compilation, camera, WebGPU renderer, screen-space point/node sizes, controls, resize, interaction sync, results, recovery, and teardown.                                          |
| Interaction | `createInteractionState`, `InteractionTarget`, `setTargetSelected`, `setTargetHighlighted`, `setTargetHovered`, `isTargetSelected`, `isTargetHighlighted`, `isHoveredTarget`, `clearSelection`, `resolve*Style` | Opaque immutable selection, highlight, and single-hover state. Body visibility and explicit style overrides remain separate target-scoped layers.                                          |
| Camera      | `createCamera`, `setProjection`, `orbitCamera`, `panCamera`, `zoomCamera`, `fitCamera`                                                                                                                          | Immutable camera values and projection/navigation math.                                                                                                                                    |
| Picking     | `FemViewport.pick`, `PickHit`, `interactionTargetFromHit`, `InteractionGranularity`                                                                                                                             | One complete side-effect-free GPU hit plus explicit host-owned interaction-target conversion.                                                                                              |
| Results     | `createResultField`, `ViewportResultsConfig`                                                                                                                                                                    | Authored nodal/elemental scalar values, ranges, maps, and optional nodal deformation configuration.                                                                                        |
| IO          | `parseVtk`, `writeVtk`, `validateModel`, `createResultFieldFromModelResult`                                                                                                                                     | The single supported VTK legacy interchange boundary, diagnostics, and narrow conversion into authored viewport result fields.                                                             |
| Platform    | `queryWebGpuSupport`, `WebGpuUnsupportedError`, `requestWebGpuDevice`                                                                                                                                           | Capability probing, typed unsupported results, device creation, and loss information.                                                                                                      |

## Ownership and identity rules

- A `Part` is reusable local geometry constructed by `createPart`. It does not
  own a world transform, and callers cannot provide a separate bounds value.
- A placement references a part or assembly definition; it does not copy
  geometry.
- `PartId` and `AssemblyId` identify registry definitions within a scene.
- `InstanceId` identifies a placement occurrence and remains stable when
  visibility or draw-order compaction changes.
- `AssemblyNodeId` identifies one expanded assembly occurrence, including
  repeated placements of the same assembly definition.
- `ElementId` is part-local. An oriented face is identified by its
  `(elementId, faceIndex)` pair; `FaceKey` remains the canonical adjacency
  identity and is not a substitute for orientation. `NodeId` is model-local.
- `BodyId` is part-local. A body groups element membership in reusable geometry;
  body interaction state is scoped by the placement `InstanceId`.
- `Scene` is the authoring source of truth. `SceneRuntime`, typed arrays, draw
  orders, GPU buffers, and batch records are derived representations.
- `FemViewport` is the public owner of `SceneRuntime` and the internal WebGPU
  renderer; hosts do not manually synchronize packed runtime and renderer
  state.

For imported data, `createElementModelFromFemModel` is the validated conversion
from the serializable VTK-backed `FemModel` into the dense `ElementModel`
consumed by element tessellation. Hosts then call
`heterogeneousElementParts` once and register its explicit homogeneous
primitive parts in an `Assembly`, which is the logical mixed-model composition
and placement boundary. A selected `ModelResultField` enters the authored
results path through `createResultFieldFromModelResult` before
`FemViewport.setResults()`.

## Viewport surface

### Lifecycle and scene

| Method                            | Purpose                                                                                                       |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `setScene(scene)`                 | Replace the authoritative scene and rebuild the derived runtime.                                              |
| `setCamera(camera)` / `fitView()` | Set or fit the immutable camera value; `fitContentInset` can keep host overlays outside the fitted rectangle. |
| `resize()`                        | Match WebGPU render size to the canvas and device pixel ratio.                                                |
| `invalidate()` / `render()`       | Schedule or perform a render of the current state.                                                            |
| `batch(operation)`                | Coalesce synchronous mutations into one invalidation and render.                                              |
| `recover()`                       | Recreate supported WebGPU resources after device loss.                                                        |
| `destroy()`                       | Release renderer, resize, and camera-control resources.                                                       |

### Visibility and interaction

`setPartVisible`, `setAssemblyNodeVisible`, `setAssemblyVisible`, and
`setInstanceVisible` update the viewport-owned derived runtime using stable part,
assembly, and placement handles, then synchronize only affected instance records.
Style,
selection, highlight, and hover changes are expressed as a new opaque
`InteractionState` and installed with `setInteraction`. Use target-level
operations for all six supported target kinds; query helpers provide state
without exposing the internal collections. Body visibility and explicit style
overrides remain separate, placement-scoped layers.

When result visualization is active, `viewport.interaction` remains the exact
host-owned value passed to `setInteraction`. The viewport derives a private
effective render interaction by layering result colors over that base value;
hosts never receive or need to round-trip the derived element overrides.

Interaction state is immutable and opaque. It stores at most one hovered target;
setting a new hover replaces the previous target. Part and instance state establish
the base style; body state adds placement-scoped visibility and emphasis; element,
face, and node state provide more specific emphasis; explicit overrides are
resolved by the existing style resolvers. The renderer receives GPU attributes
rather than CPU material clones.

### Picking

```ts
const hit = await viewport.pick(x, y);
if (hit?.kind === "face") {
  console.log(hit.partId, hit.instanceId, hit.faceId, hit.normal, hit.worldPosition);
}
const target = hit === undefined ? undefined : interactionTargetFromHit(hit, "face");
```

`pick` returns one deepest `PickHit` or `undefined`, including the exact displayed
world point reconstructed from the same GPU depth readback. Element, face, and node
hits include the owning `bodyId` when the geometry provides one. Hosts choose a
selection identity separately with `interactionTargetFromHit`; unsupported requests
return `undefined` and body identity is never guessed. There is no multi-hit pick-list
API in the current contract.

### Static results

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

viewport.setResults({
  field: stress,
  deformation: { field: displacement, scale: 1.5 },
});

viewport.clearResults();
```

`ViewportResultsConfig` supports authored scalar fields at nodal or elemental
locations, explicit or observed ranges, scalar color maps, and optional
one-load-case nodal deformation. Derived engineering quantities, result glyphs,
playback, interpolation, and legends are outside the current core API.

## Additional supported APIs

These exports are supported utilities around the canonical viewport path:

- `createSceneRuntime` / `SceneRuntime` for hosts that intentionally own
  runtime compilation and stable-handle queries.
- `installCameraControls` and the lower-level camera math for custom viewport
  shells.
- `interactionTargetFromHit` for pure host-side selection policy.

The low-level WebGPU renderer is internal to `FemViewport` and is not exported
from the package root. A custom renderer lifecycle requires a separate product
decision and stable public ownership contract.

Advanced APIs must not become a reason to expose runtime slots, GPU record
layouts, storage capacities, or parallel renderer abstractions as new default
concepts.

## Current gaps under review

The following are intentionally not implied by today's API and are tracked as
separate proposals:

- Batched interaction invalidation remains tracked in
  [#234](https://github.com/dirkphilip/femgx/issues/234).

These proposals must still pass the product decision gate before adding public
surface. The existing exhaustive export inventory is maintained in
[[architecture/public-api-audit|Public API audit]].

## Review checklist for API changes

Before adding a public symbol, confirm:

1. It has one clear owning subsystem and data owner.
2. Its identity is stable through scene compilation, instancing, and picking.
3. It fits the `Part → Assembly → Scene → FemViewport` flow.
4. It has the smallest behavior that delivers concrete user value.
5. Existing abstractions can be extended or simplified before a new one is
   introduced.
6. The API example, unit/e2e coverage, package smoke test, and relevant wiki
   note can all describe the same contract.

Related: [[architecture/api-design|API design north star]],
[[architecture/public-api-audit|Public API audit]],
[[architecture/demo-library-boundary|Demo / library boundary]],
[[rendering/platform-support|WebGPU platform support]].

[architecture/api-design|API design north star]: api-design.md
[architecture/demo-library-boundary|Demo / library boundary]: demo-library-boundary.md
[architecture/public-api-audit|public API audit]: public-api-audit.md
[rendering/platform-support|WebGPU platform support]: ../rendering/platform-support.md
[requirements/product-scope|Product scope]: ../requirements/product-scope.md
