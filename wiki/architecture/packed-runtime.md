# Packed scene runtime

The runtime (issue #3) compiles the authoring [[architecture/architecture-overview|scene
model]] into a packed, typed-array representation with delta-oriented
visibility updates.

## What it provides

`createSceneRuntime(scene)` returns the stable-handle `SceneRuntime` public
boundary. Its renderer-owned packed counterpart is created internally by
`createPackedSceneRuntime` and is not part of the package root API.

The public runtime exposes stable instance and assembly-occurrence handles via
`getInstances()`, `getOccurrences()`, `getInstance(instanceId)`, and
`getOccurrence(occurrenceId)`. It is query-only; every transform and collection
result is a defensive snapshot, and live visibility mutations go through
`FemViewport`, which keeps CPU runtime state, GPU buffers, invalidation, and
picking synchronized. `getVisibleInstanceIds()` returns visible handles in
deterministic depth-first runtime order, not the renderer's private part-batched
draw order. `RuntimeOccurrence.instanceIds` contains only direct part placements;
walk `childIds` when a subtree is required.

The internal packed representation stores, in typed arrays indexed by private
slots:

- world transforms (`instanceWorldTransforms`, 16 floats per instance),
- part references (`instancePartIds`),
- a compiled assembly tree (`nodeParents`, `nodeFirstChild`, `nodeNextSibling`)
  with per-node authoring/effective visibility, and
- per-instance visibility bits (`instanceVisible`) plus a contiguous subtree
  instance range per node (`nodeInstanceStart/End`).

`RuntimeState` is the single owner of those compiled fields. The internal
`PackedSceneRuntime` augments that state with behavior and stable identity
indexes; it does not copy the field schema into a second runtime projection.
Renderer attachments derive draw calls from their existing layout builder, and
interaction diffs reuse the runtime's identity/group indexes.

The packed compiler is the only placement-path algorithm and updates persistent
runtime state in place after the initial compile. Explicit placement ids are
used as path segments when present; otherwise the validated sibling index is
the deterministic fallback. Stable placement paths are resolved through
runtime-owned reverse maps; callers never need to know the slot layout.

Node placement transforms are composed transiently while the scene draft is
walked and are not retained in packed or public runtime state. Instance world
transforms remain because rendering, bounds, picking, and result deformation
consume the placed-part transform directly.

## Internal visibility deltas

Private packed-runtime updates apply immediately and return a slot-oriented
visibility delta:

- `setPartVisible(partId, visible)` — flips the authoring part flag of that
  part's instance slots.
- `setAssemblyVisible(assemblyId, visible)` — flips node authoring visibility
  and recomputes the affected subtree (short-circuits when effective visibility
  is unchanged).
- `setInstanceVisible(instanceId, visible)` — per-placement override.

Effective visibility is `instanceOverride && partVisible && every ancestor node
visible` (bottom-up inheritance, unchanged from the authoring model). Hiding an
ancestor hides everything beneath it; showing a descendant cannot override a
hidden ancestor. Updates touch only the affected instance slots and report the
changed ids plus before/after `visibleCount`; geometry and the instance list are
never rebuilt.

The viewport maps those affected slots directly to renderer uploads. Public
callers use the viewport visibility methods and read the resulting state from
`viewport.runtime`; they do not receive or apply mutation deltas.

The internal runtime maintains both slot → handle and handle → slot maps. This
lets
the [[rendering/renderer-subrange-updates|renderer]] map interaction state and pick hits
back to slots.

## Design notes

- One compiled node per assembly _expansion_, so an assembly placed multiple
  times becomes multiple nodes with independent subtrees.
- `Scene.build()` now validates references and cycles, so the runtime assumes
  valid input but still skips missing assemblies defensively.
- The packed typed arrays are private implementation state; public queries never
  return those views. `viewport.runtime` is the current live query facade, so hosts
  should read it again after `setScene()` or `updateScene()`. Standalone
  `createSceneRuntime(scene)` is a CPU-only immutable compiled snapshot for host
  inspection and does not own a renderer or visibility mutations.

Visibility deltas are now wired to GPU subrange updates in the
[[rendering/renderer-subrange-updates|renderer]].

Related: [[engineering/performance-issues|Performance issues and risks]].

[engineering/performance-issues|Performance issues and risks]: ../engineering/performance-issues.md
[rendering/renderer-subrange-updates|renderer]: ../rendering/renderer-subrange-updates.md
