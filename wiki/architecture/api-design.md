# API design north star

The default and only public rendering lifecycle is
`createViewport({ canvas, scene })`. The viewport owns the derived
`SceneRuntime`, internal WebGPU renderer, fitted camera, standard controls,
resize synchronization, render invalidation, device recovery, and teardown.
Lower-level renderer construction remains an internal implementation detail;
camera math, stable runtime queries, and pick-id resolution are separate
supported utilities when a host needs them.

This note defines the intended public vocabulary and ownership boundaries for
the experimental API. It is the design reference for changes to the public
surface; the concise [[architecture/core-api|Core API review]] is the reader
oriented API map, and the root [[../index|wiki index]] is the navigation map.

The published root import is `femgx`. FE authoring, interchange, optional GLB,
custom camera, runtime inspection, and raw WebGPU ownership are intentionally
published as `femgx/model`, `femgx/io`, `femgx/io/glb`, `femgx/camera`,
`femgx/runtime`, and `femgx/platform`; see the
[0.x migration map](../../docs/migration-0.x-entry-points.md).

## Canonical concepts

| Concept             | Current representation | Responsibility                                                                     |
| ------------------- | ---------------------- | ---------------------------------------------------------------------------------- |
| Part definition     | `Part` / `createPart`  | Validated immutable reusable geometry, derived bounds, and optional element ranges |
| Part instance       | `PartPlacement`        | A reference to a part definition plus a local transform                            |
| Assembly definition | `NamedAssembly`        | Ordered hierarchy of part and assembly placements                                  |
| Scene registry      | `Scene`                | Authoritative maps of parts and assemblies plus visibility state                   |
| Scene runtime       | `SceneRuntime`         | Stable placement/assembly-occurrence queries; live mutations belong to `Viewport`  |
| Viewport            | `Viewport`             | Public scene lifecycle, GPU rendering, and stable capability facades               |

`SceneRuntime` is the defensive query boundary: its public transforms and
collections are snapshots, and `RuntimeOccurrence.instanceIds` contains only
direct part placements. The canonical viewport owns the current live facade at
`viewport.runtime`; standalone `createSceneRuntime(scene)` is a CPU-only
immutable compiled snapshot for intentional host inspection.

The API may eventually introduce explicit `PartDefinition` and
`PartInstance` names, but it must preserve this semantic distinction even
while the implementation uses the shorter current names.

`Viewport` remains the single lifecycle owner. Its stable non-owning facades
are `viewport.view` for camera/navigation, `viewport.interaction` for live
interaction state and physical picking, `viewport.visibility` for scene-owned
visibility mutations, `viewport.results` for the current authored snapshot,
and `viewport.presentation` for clipping and renderer-owned presentation.
They delegate into one live owner rather than caching a scene, runtime, or
renderer snapshot. All capability reads and mutations use the same destroyed
state boundary as the root lifecycle.

## Canonical data flow

```text
Typed ElementModel ─────────┐
Surface-derived topology ───┴─→ Part + assembly placements
                                ↓
                              Scene
                                ↓
                       createViewport
                                ↓
                        viewport.runtime
```

Reusable geometry is defined once. Instances refer to that definition by a
stable part key and carry only placement-specific state such as transform,
visibility, and interaction style. The renderer must never become the source
of truth for scene data.

`createElementModel(nodes, elements, options)` is the authoring boundary for
typed finite-element data. It owns optional bodies with stable identities and
direct element membership. Omitting bodies is a real zero-cost path: it derives
no model-scaled body index or renderer resource. Semantic element blocks are
removed; bodies and elements are the complete grouping hierarchy.
`createPart(id, input)` remains the
construction boundary for reusable parts. Local buffers live in the plural
`input.geometries` collection; complete element, node-position, and optional body
tables live beside it at part level. The boundary validates those inputs and
derives bounds from local positions. `PartId` is a direct unsigned 32-bit
identity; element and body ids reserve the top raw value because `0` is
the no-hit sentinel. Derived descriptors never become a second authoring
source.

Raw geometry follows this boundary directly:

```ts
const part = createPart(10, { geometries: [{ positions, indices, primitive: "triangles" }] });
```

Typed FE data uses the same reusable-part path. A mixed `ElementModel` is
compiled into one semantic `Part` with homogeneous primitive leaves, and an
`Assembly` places that part without copying its geometry:

```ts
const part = elementPart(10, model);
const scene = createScene()
  .addPart(part)
  .addAssembly({
    id: 1,
    name: "model",
    placements: [{ kind: "part", partId: 10, transform: identity() }],
  })
  .withRoot(1)
  .build();
```

Hosts that already own a reduced display surface use the explicit-topology
authoring boundary defined by
[[requirements/surface-derived-part-authoring|surface-derived part authoring]].
It compiles retained facets, lines, and points into the same reusable `Part`
without reconstructing omitted solid connectivity.

```ts
const part = surfacePart(10, {
  positions,
  facets: { connectivity: facets, elementIds, faceIndices },
  lines: { connectivity: lines, elementIds: lineElementIds },
  points: { nodeIds: pointNodeIds, elementIds: pointElementIds },
});
```

## Registry and identity rules

- `Scene.parts` is the part-definition registry, keyed by `PartId`.
- `Scene.assemblies` is the assembly-definition registry, keyed by
  `AssemblyId`.
- A placement references a registry entry; it does not copy geometry.
- A placement may provide a unique `placementId` within its owning assembly;
  compiled instance and assembly-occurrence handles use it so reorder and
  transform edits preserve identity. Legacy placements use their validated
  sibling index as the deterministic fallback.
- An instance identity must remain stable when visibility or draw-order
  compaction changes.
- Runtime slots and GPU-local slots are implementation details and must not
  leak into the authoring API.
- The authoritative CPU representation owns the model data; typed arrays in
  the private packed runtime and GPU buffers are compiled representations. The
  public `SceneRuntime` exposes stable handles and defensive query objects, not
  slots or mutation deltas. `Viewport.runtime` is the current live facade;
  hosts should reacquire it after `setScene` or `updateScene`. Standalone
  `createSceneRuntime(scene)` is a CPU-only immutable compiled snapshot for
  intentional host inspection. Live visibility changes and transactional
  structural scene updates go through `Viewport`.

## Public API boundary

The main user workflow should be expressible as:

1. Define or import reusable part definitions.
2. Register part and assembly definitions in a scene.
3. Place a definition one or more times with transforms.
4. Create one `Viewport`.
5. Apply interaction, visibility, structural updates, results, and lifecycle
   operations through it.

`Viewport.updateScene(scene)` is the transactional structural-update
boundary. It recompiles the candidate scene before committing it, preserves the
camera and state tied to surviving placement ids, prunes references to removed
inner geometry identities, and revalidates active results. Its
`SceneUpdateOutcome` makes a result clear actionable without exposing runtime
slots or renderer resources; `setScene` remains the explicit full-replacement
operation.

Low-level flattening, batching, culling, draw-order buffers, GPU record
layouts, and storage capacities are renderer/runtime implementation details.
They remain internal until a concrete host need justifies a separate product
decision and stable public lifecycle contract.

### Elemental orientation results

The public results boundary supports authored scalar coloring, nodal deformation,
and one orthogonal elemental vector or full-frame presentation role. `Viewport` owns all
roles in the same atomic result replacement; `Part`, `Scene`, and
`SceneRuntime` do not own glyph state. The vector role's public vocabulary is
limited to an authored field, `arrow`/`axis` presentation, `direction`/`normal`
transform semantics, and a finite positive element-relative scale:

```ts
viewport.results.set({
  scalar: { field: stress },
  deformation: { field: displacement, scale: 1.5 },
  vectors: { field: directions, glyph: "arrow", transform: "normal", widthPixels: 2 },
});
```

All present roles are validated before the previous state is replaced. Anchors,
records, GPU resources, and fixed presentation policy stay internal; see
[[data/vector-field-visualization|Authored elemental orientation visualization]].
Full orientation uses the explicit `ElementFrameField` format: an owning
reusable `partId` plus nine dense part-local floats per element row in X/Y/Z
axis order. It is intentionally not
a vector-field extension because roll cannot be represented by one direction.
`glyph: "triad"` draws the renderer-owned non-pickable RGB axes and shares the
part data across all placements. Applied loads, occurrence-specific overrides,
and user glyph plugins remain deferred; copying a part is the current host
workaround for distinct instance values.

## Design test for new features

A new public concept belongs in the API only when it has a clear owner, a
stable identity/data-ownership story, a place in the canonical data flow, and
an end-to-end example. Otherwise record it as an internal design note or an
issue until the boundary is clear.

Related: [[architecture/architecture-overview|Architecture overview]],
[[architecture/packed-runtime|Packed scene runtime]].

[../index|wiki index]: ../index.md
[architecture/architecture-overview|Architecture overview]: architecture-overview.md
[architecture/core-api|Core API review]: core-api.md
[architecture/packed-runtime|Packed scene runtime]: packed-runtime.md
[data/vector-field-visualization|Authored elemental orientation visualization]: ../data/vector-field-visualization.md
[requirements/surface-derived-part-authoring|surface-derived part authoring]: ../requirements/surface-derived-part-authoring.md
