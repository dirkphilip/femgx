# API design north star

The default and only public rendering lifecycle is
`createViewport({ canvas, scene })`. The viewport owns the derived
private packed scene state, internal WebGPU renderer, fitted camera, standard controls,
resize synchronization, render invalidation, device recovery, and teardown.
Lower-level renderer construction remains an internal implementation detail;
camera math, stable runtime queries, and pick-id resolution are separate
supported utilities when a host needs them.

This note defines the intended public vocabulary and ownership boundaries for
the experimental API. It is the design reference for changes to the public
surface; the concise [[architecture/core-api|Core API review]] is the reader
oriented API map, and the root [[../index|wiki index]] is the navigation map.

The published root import is `femgx`. FE authoring, interchange, optional GLB,
custom camera, and raw WebGPU ownership are intentionally published as
`femgx/model`, `femgx/io`, `femgx/io/glb`, `femgx/camera`, and
`femgx/platform`; placed-occurrence inspection is viewport-owned.

## Canonical concepts

| Concept             | Current representation | Responsibility                                                                     |
| ------------------- | ---------------------- | ---------------------------------------------------------------------------------- |
| Part definition     | `Part` / `createPart`  | Validated immutable reusable geometry, derived bounds, and optional element ranges |
| Part placement      | `PartPlacement`        | An authored reference to a part definition plus a local transform                  |
| Part occurrence     | `PartOccurrenceId`     | One expanded runtime identity produced from the reusable assembly hierarchy        |
| Assembly definition | `AssemblyDefinition`   | Ordered hierarchy of part and assembly placements                                  |
| Scene registry      | `Scene`                | Authoritative maps of parts and assemblies plus visibility state                   |
| Placed occurrences  | `SceneOccurrences`     | Stable placement/assembly-occurrence queries; live mutations belong to `Viewport`  |
| Viewport            | `Viewport`             | Public scene lifecycle, GPU rendering, and stable capability facades               |

`SceneOccurrences` is the defensive query boundary: public transforms and
records are snapshots, while model-sized collections stream fresh.
`AssemblyOccurrence.partOccurrenceCount` plus its ordinal getter expose only
direct part placements. The canonical viewport owns the live facade at
`viewport.occurrences`; packed scene compilation remains internal.

The public API keeps definitions, authored placements, and expanded occurrences
distinct. A definition owns reusable geometry, a placement owns the authored
reference and local transform, and an occurrence owns runtime-scoped visibility
and interaction state. Editing one placement in a reused assembly definition
therefore affects every occurrence expanded from that placement.

`Viewport` remains the single lifecycle owner. Its stable capability owners are
`viewport.view` for camera/navigation, `viewport.interaction` for live
interaction state and physical picking, `viewport.visibility` for scene-owned
visibility mutations, `viewport.results` for the current authored snapshot,
and `viewport.presentation` for clipping and renderer-owned presentation.
They share the viewport's live scene, renderer, and lifecycle owners rather
than caching a scene, runtime, or renderer snapshot. All capability reads and
mutations use the same destroyed state boundary as the root lifecycle.

## Canonical data flow

```text
Typed ElementModel ─────────┐
Surface-derived topology ───┴─→ Part + assembly placements
                                ↓
                              Scene
                                ↓
                       createViewport
                                ↓
                     viewport.occurrences
```

Reusable geometry is defined once. Part occurrences refer to that definition by a
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

Dense FE producers may supply validated authored semantic columns through the
same internal `Part` construction boundary. The columns are the authoritative
full-volume element, face, neighbor, edge, and body data; public `elements`,
`faces`, and `edges` remain lazy convenience views and do not become a second
runtime graph. Renderer upload, visibility skins, picking, section caps,
selected bounds, and orientation topology use the columns directly. This is
an implementation choice for dense producers, not a public `PackedPart` or
renderer mode. Ordinary `createPart` object input remains available for raw or
irregular authored geometry whose exact public keys cannot be normalized
without changing its semantics. Optional descriptor-consuming features may
still materialize their own feature-local records; the benchmark reports this
separately from portable typed-array retention.

Raw geometry follows this boundary directly:

```ts
const part = createPart(10, { geometries: [{ positions, indices, primitive: "triangles" }] });
```

Typed FE data uses the same reusable-part path. A mixed `ElementModel` is
compiled into one semantic `Part` with homogeneous primitive leaves, and an
`Assembly` places that part without copying its geometry:

```ts
const part = createPartFromElementModel(10, model);
const scene = createSceneBuilder()
  .addPart(part)
  .addAssembly({
    id: 1,
    name: "model",
    placements: [
      { kind: "part", placementId: "model-part", partId: 10, transform: identityMatrix() },
    ],
  })
  .setRootAssembly(1)
  .build();
```

Hosts that already own a reduced display surface use the explicit-topology
authoring boundary defined by
[[requirements/surface-derived-part-authoring|surface-derived part authoring]].
It compiles retained facets, lines, and points into the same reusable `Part`
without reconstructing omitted solid connectivity.

```ts
const part = createPartFromExplicitTopology(10, {
  positions,
  facets: { connectivity: facets, elementIds },
  lines: { connectivity: lines, elementIds: lineElementIds },
  points: { nodeIds: pointNodeIds, elementIds: pointElementIds },
});
```

The shown facet form is element/node-only: it retains host-mappable element and
node identity but no authored face, neighbor, or facet-derived edge identity.
Add aligned `faceIndices` (and optional `neighbors`) when face capability is
required. All primitive leaves reference one copied part-owned node table; this
is private `Part` construction detail, not a packed-geometry or renderer API.

Future host-authored CAD topology is explicitly Deferred by the
[[requirements/product-scope#semantic-cad-topology-is-deferred|scope contract]].
Its minimum useful slice should reuse this definition/occurrence lifecycle and
map tessellated triangle ranges back to stable CAD body and face identities for
picking, visibility, and emphasis. Face-boundary curves may remain display
lines. It must not encode CAD faces as finite elements, introduce a second
scene graph, or require a generic shell/loop/edge/vertex topology model. Exact
B-rep geometry and kernel operations remain host-owned; future finer display
tessellations may arrive as complete part revisions with preserved source
identities rather than renderer-owned adaptive tessellation or LOD. A later
product decision must establish any narrower boundary.

## Registry and identity rules

- `Scene.parts` is the part-definition registry, keyed by `PartId`.
- `Scene.assemblies` is the assembly-definition registry, keyed by
  `AssemblyId`.
- A placement references a registry entry; it does not copy geometry.
- A placement requires a unique `placementId` within its owning assembly;
  compiled instance and assembly-occurrence handles use it so reorder and
  transform edits preserve identity.
- An instance identity must remain stable when visibility or draw-order
  compaction changes.
- Runtime slots and GPU-local slots are implementation details and must not
  leak into the authoring API.
- The authoritative CPU representation owns the model data; typed arrays in
  the private packed runtime and GPU buffers are compiled representations.
  `Viewport.occurrences` exposes stable handles and defensive query objects,
  not slots or mutation deltas. The facade remains attached to the viewport
  across `replaceScene` and committed `updateScene` calls. Live visibility
  changes and transactional structural scene updates go through `Viewport`.

## Public API boundary

The main user workflow should be expressible as:

1. Define or import reusable part definitions.
2. Register part and assembly definitions in a scene.
3. Place a definition one or more times with transforms.
4. Create one `Viewport`.
5. Apply interaction, visibility, structural updates, results, and lifecycle
   operations through it.

`Viewport.updateScene(operation)` is the transactional structural-update
boundary. The synchronous operation edits a copy-on-write draft by definition
and explicit authoring-placement identity. It validates changed ownership
boundaries before committing. Transform-only revisions validate the changed
matrix, patch retained runtime/GPU instance records, and update placed bounds.
`SceneUpdate.addPlacement`, `replacePlacement`, and `removePlacement` operate on
complete explicitly identified authored records. Direct part-placement revisions
reuse private runtime and part-local GPU slots and rebuild only affected part
orders. Remove plus add of the same placement identity in one transaction is
coalesced to the same final replacement. A newly registered immutable part and
its first direct occurrences use that same path,
admitting only the new definition and uploading its geometry once when first drawn.
A cascading part-definition removal uses the same release path, then retires only
that part's resources; part replacement and assembly-topology revisions retain the
complete validation/compile path. The
viewport preserves the camera and state tied to surviving placement ids, prunes
references to removed inner geometry identities, and revalidates active results.
`SceneUpdateOutcome` makes a result clear actionable without exposing runtime slots or renderer resources;
`replaceScene` remains the explicit unrelated-model operation.

Low-level flattening, batching, culling, draw-order buffers, GPU record
layouts, and storage capacities are renderer/runtime implementation details.
They remain internal until a concrete host need justifies a separate product
decision and stable public lifecycle contract.

### Elemental orientation results

The public results boundary supports authored scalar coloring, nodal deformation,
and one orthogonal elemental vector or full-frame presentation role. `Viewport` owns all
roles in the same atomic result replacement; `Part`, `Scene`, and occurrence
inspection do not own glyph state. The vector role's public vocabulary is
limited to an authored field, `arrow`/`axis` presentation, `direction`/`normal`
transform semantics, and a finite positive element-relative scale:

```ts
viewport.results.set({
  scalar: { field: stress },
  deformation: { field: displacement, scale: 1.5 },
  orientation: { field: directions, glyph: "arrow", transform: "normal", widthPixels: 2 },
});

// Reuse one part while assigning authored rows to one placement.
viewport.results.set({
  scalar: { field: sharedStress, range: comparisonRange },
  occurrences: [
    {
      partOccurrenceId: rightOccurrence,
      scalar: { field: rightStress, range: comparisonRange },
      deformation: { field: rightDisplacement },
    },
  ],
});
```

All present roles are validated before the previous state is replaced. Anchors,
records, GPU resources, and fixed presentation policy stay internal; see
[[data/vector-field-visualization|Authored elemental orientation visualization]].
Full orientation uses the explicit `ElementFrameField` format: an owning
reusable `partId` plus nine dense part-local floats per element row in X/Y/Z
axis order. It is intentionally not
a vector-field extension because roll cannot be represented by one direction.
`glyph: "triad"` draws the renderer-owned non-pickable RGB axes. Shared roles
remain the cheap default for every placement. An `occurrences` entry may replace
scalar, deformation, orientation, or load rows for one stable
`PartOccurrenceId`; geometry, topology, and public identities remain shared,
while private result addressing uses packed part-local occurrence slots.

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
[requirements/product-scope#semantic-cad-topology-is-deferred|scope contract]: ../requirements/product-scope.md#semantic-cad-topology-is-deferred
