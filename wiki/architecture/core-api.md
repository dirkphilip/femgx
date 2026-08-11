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
scene, create one viewport, and drive visibility/interaction/results through
that viewport. Geometry is uploaded once per part and reused across placement
instances.

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

const viewport = await createFemViewport({ canvas, scene });

let interaction = createInteractionState();
interaction = setPartOverride(interaction, part.id, {
  color: { r: 0.2, g: 0.6, b: 0.95, a: 1 },
});
viewport.setInteraction(interaction);
viewport.setPartVisible(part.id, false);
viewport.clearResults();
viewport.destroy();
```

`positions` and `indices` are application-owned typed arrays. `elements` is
optional; when present, each triangle belongs to exactly one stable element
range and can participate in element picking and interaction.

## Core vocabulary and owners

| Area        | Core API                                                                                                                 | Owns                                                                                                                                                                                       |
| ----------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Geometry    | `Geometry`, `Part`, `createPart`, `Body`, `FaceSubset`, `polygonGeometry`, `polygonPart`                                 | Validated immutable local positions, indices, optional body/element/node/face metadata, and derived local bounds. Focused validators and raw bound calculation are implementation helpers. |
| Elements    | `createElement`, `ElementModel`, `heterogeneousElementParts`, `boundaryFaceRefs`, `FaceIdRef`, `ElementShape`            | Validated FE connectivity (point, line, triangle, quad, Tet4, Tet10, Hex8, Hex20), canonical topology, mixed primitive grouping, and face selection inputs.                                |
| Assemblies  | `NamedAssembly`, `PartPlacement`, `SubAssemblyPlacement`                                                                 | Reusable hierarchical placement definitions and local transforms.                                                                                                                          |
| Scene       | `createScene`, `SceneBuilder`, `Scene`                                                                                   | Authoritative part/assembly registries, root identity, and authoring visibility state.                                                                                                     |
| Viewport    | `createFemViewport`, `FemViewport`, `FemViewportOptions`                                                                 | Runtime compilation, camera, WebGPU renderer, controls, resize, interaction sync, results, recovery, and teardown.                                                                         |
| Interaction | `createInteractionState`, `setPart*`, `setInstance*`, `setBody*`, `setElement*`, `setFace*`, `setNode*`, `resolve*Style` | Immutable selection, highlight, hover, visibility, and style state.                                                                                                                        |
| Camera      | `createCamera`, `setProjection`, `orbitCamera`, `panCamera`, `zoomCamera`, `fitCamera`                                   | Immutable camera values and projection/navigation math.                                                                                                                                    |
| Picking     | `FemViewport.pick`, `FemViewport.pickPoint`, `PickTarget`, `PickGranularity`                                             | GPU readback and stable part/instance/element/face/node target resolution.                                                                                                                 |
| Results     | `createResultField`, derived-field helpers, `ViewportResultsConfig`                                                      | Typed nodal/elemental values, derivations, ranges, maps, and deformation configuration.                                                                                                    |
| IO          | `parseVtk`, `writeVtk`, `validateModel`                                                                                  | The single supported VTK legacy interchange boundary and diagnostics.                                                                                                                      |
| Platform    | `queryWebGpuSupport`, `WebGpuUnsupportedError`, `requestWebGpuDevice`                                                    | Capability probing, typed unsupported results, device creation, and loss information.                                                                                                      |

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
- `ElementId` is part-local. `FaceId` is part-local and indexes the part's
  face descriptors. `NodeId` is model-local.
- `BodyId` is part-local. A body groups element membership in reusable geometry;
  body interaction state is scoped by the placement `InstanceId`.
- `Scene` is the authoring source of truth. `SceneRuntime`, typed arrays, draw
  orders, GPU buffers, and batch records are derived representations.
- `FemViewport` is the normal owner of `SceneRuntime` and
  `WebGpuRenderer`; hosts should not manually synchronize both unless they
  deliberately use an advanced path.

For imported data, `createElementModelFromFemModel` is the one validated
conversion from the serializable VTK-backed `FemModel` into the dense
`ElementModel` consumed by element tessellation. Hosts then call
`heterogeneousElementParts` once and register its explicit primitive parts in
the scene.

## Viewport surface

### Lifecycle and scene

| Method                            | Purpose                                                          |
| --------------------------------- | ---------------------------------------------------------------- |
| `setScene(scene)`                 | Replace the authoritative scene and rebuild the derived runtime. |
| `setCamera(camera)` / `fitView()` | Set or fit the immutable camera value.                           |
| `resize()`                        | Match WebGPU render size to the canvas and device pixel ratio.   |
| `invalidate()` / `render()`       | Schedule or perform a render of the current state.               |
| `batch(operation)`                | Coalesce synchronous mutations into one invalidation and render. |
| `recover()`                       | Recreate supported WebGPU resources after device loss.           |
| `destroy()`                       | Release renderer, resize, and camera-control resources.          |

### Visibility and interaction

`setPartVisible`, `setAssemblyNodeVisible`, `setAssemblyVisible`, and
`setInstanceVisible` update the derived runtime using stable part, assembly,
and placement handles, then synchronize only affected instance records. Style,
selection, hover, and highlight changes are expressed
as a new `InteractionState` and installed with `setInteraction`. Body visibility
and emphasis are scoped by placement and body id and use the same immutable
interaction object.

Interaction state is immutable and layered. Part and instance state establish
the base style; body state adds placement-scoped visibility and emphasis; element,
face, and node state provide more specific emphasis; explicit overrides are
resolved by the existing style resolvers. The renderer receives GPU attributes
rather than CPU material clones.

### Picking

```ts
const target = await viewport.pick(x, y, "face");
if (target?.kind === "face") {
  console.log(target.partId, target.instanceId, target.faceId, target.normal);
}

const point = await viewport.pickPoint(x, y);
```

`pick` returns one `PickTarget` or `undefined`. Element, face, and node targets
include the owning `bodyId` when the geometry provides one. The optional granularity can
request `part`, `instance`, `element`, `face`, or `node`; requesting a level
that the hit cannot support resolves to the deepest available target. There is
no multi-hit pick-list API in the current contract.

### Static results

Result fields are typed by location (`"nodal"` or `"elemental"`) and shape
(`"scalar"`, `"vector"`, or `"tensor"`). Tensor values use Voigt order
`[xx, yy, zz, xy, yz, zx]`; missing values are `NaN`.

```ts
const stress = createResultField({
  id: "stress",
  name: "Stress",
  location: "elemental",
  shape: "tensor",
  count: elementCount,
  unit: "MPa",
  values: stressValues,
});

viewport.setResults({
  field: stress,
  derive: "vonMises",
  deformation: { field: displacement, scale: 1.5 },
});

viewport.clearResults();
```

`ViewportResultsConfig` supports scalar fields directly, vector magnitude,
tensor magnitude/von Mises/maximum principal derivations, explicit or observed
ranges, scalar color maps, and optional one-load-case nodal deformation.
Playback, interpolation, and legends are outside the current core API.

## Advanced APIs

These exports are supported but are not the default composition path:

- `createSceneRuntime` / `SceneRuntime` for hosts that intentionally own
  runtime compilation and stable-handle queries.
- `createWebGpuRenderer` / `WebGpuRenderer` for custom renderer lifecycles.
- `installCameraControls` and the lower-level camera math for custom viewport
  shells.
- `resolvePick` / `resolvePickTarget` for host-side pick-id resolution.

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
