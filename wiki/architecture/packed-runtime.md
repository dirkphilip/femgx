# Packed scene runtime

The runtime (issue #3) compiles the authoring [[architecture/architecture-overview|scene
model]] into a packed, typed-array representation with delta-oriented
visibility updates.

## What it provides

The renderer-owned packed counterpart is created internally by
`createPackedSceneRuntime`; it is not a package entry point. `Viewport.occurrences`
is the public, query-only boundary for stable part-occurrence and
assembly-occurrence handles. It offers count/indexed lookup and fresh streaming
iteration (`partOccurrences()`, `assemblyOccurrences()`, and
`visiblePartOccurrenceIds()`), so inspection does not retain model-sized object
or id arrays. Every transform and record is a defensive snapshot. Live
visibility mutations go through `Viewport`, which keeps CPU runtime state, GPU
buffers, invalidation, and picking synchronized. Visible handles stream in
deterministic depth-first order rather than renderer-private part-batched draw
order. An assembly occurrence exposes direct children and part occurrences by
local ordinal; callers walk those relationships for a subtree.

The internal packed representation stores, in typed arrays indexed by private
slots:

- world transforms (`instanceWorldTransforms`, 16 floats per instance),
- part references (`instancePartIds`),
- a compiled assembly tree (`nodeParents`, `nodeFirstChild`, `nodeNextSibling`)
  with per-node authoring/effective visibility, and
- per-instance visibility bits (`instanceVisible`) and compact node/part group
  indexes for direct placement membership.

`RuntimeState` is the single owner of those compiled fields. The internal
`PackedSceneRuntime` augments that state with behavior and stable identity
indexes; it does not copy the field schema into a second runtime projection.
Renderer attachments derive draw calls from their existing layout builder, and
interaction diffs reuse the runtime's identity/group indexes.

The packed compiler is the only placement-path algorithm and updates persistent
runtime state in place after the initial compile. Required explicit placement
ids are used as path segments. Stable placement paths are resolved through
runtime-owned reverse maps; callers never need to know the slot layout.

Node world transforms are retained only in the private packed runtime so a
changed assembly-occurrence transform can be composed through its affected
subtree without walking unrelated occurrences. Instance world transforms remain
because rendering, bounds, picking, and result deformation consume the
placed-part transform directly. A private placed-bounds segment tree updates
changed transform leaves and the renderer-owned origin-triad scale without a
complete occurrence scan; neither node transforms nor bounds-tree storage leaks
through the private packed runtime.

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
callers use the viewport visibility methods and inspect resulting stable
handles through `viewport.occurrences`; they do not receive or apply mutation
deltas.

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
  return those views. `viewport.occurrences` remains the same live query facade
  after `replaceScene()` or a committed `updateScene()` and does not own renderer
  or visibility mutation controls.

Visibility is the conjunction of part-definition, assembly-definition,
assembly-occurrence, and part-occurrence causes. Viewports retain those policies
by stable identity across a scene revision, including definitions with no current
placements, while committed removals prune occurrence overrides. Runtime deltas
carry affected part identities rather than one expanded slot list and are wired
to compact draw-order updates in the
[[rendering/renderer-subrange-updates|renderer]].
[rendering/renderer-subrange-updates|renderer]: ../rendering/renderer-subrange-updates.md
