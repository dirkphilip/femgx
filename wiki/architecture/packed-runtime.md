# Packed scene runtime

The runtime (issue #3) compiles the authoring [[architecture/architecture-overview|scene
model]] into a packed, typed-array representation with delta-oriented
visibility updates.

## What it provides

`createSceneRuntime(scene)` returns the stable-handle `SceneRuntime` public
boundary. Its renderer-owned packed counterpart is created internally by
`createPackedSceneRuntime` and is not part of the package root API.

The public runtime exposes stable instance and assembly-occurrence handles via
`getInstances()`, `getNodes()`, `getInstance(instanceId)`, and
`getNode(nodeId)`. It is query-only; live visibility mutations go through
`FemViewport`, which keeps CPU runtime state, GPU buffers, invalidation, and
picking synchronized. `getDrawList()` returns stable instance handles.

The internal packed representation stores, in typed arrays indexed by private
slots:

- world transforms (`instanceWorldTransforms`, 16 floats per instance),
- local placement transforms (`instanceLocalTransforms`) and composed node
  transforms (`nodeLocalTransforms`/`nodeWorldTransforms`, 16 floats each),
- part references (`instancePartIds`),
- a compiled assembly tree (`nodeParents`, `nodeFirstChild`, `nodeNextSibling`)
  with per-node authoring/effective visibility, and
- per-instance visibility bits (`instanceVisible`) plus a contiguous subtree
  instance range per node (`nodeInstanceStart/End`).

The packed compiler is the only placement-path algorithm and updates persistent
runtime state in place after the initial compile. Stable placement paths are
resolved through runtime-owned reverse maps; callers never need to know the
slot layout.

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

## Internal transform updates

The runtime keeps the **local placement transform** and the composed **world
transform** for every node (assembly expansion) and instance (part placement).
World transforms are recomputed only for the dirty subtree:

- `setInstanceTransform(instanceId, transform)` — replaces the instance's local
  placement transform and recomposes its world from the owning node. O(1): only
  that slot is touched, other instances of the same part are unchanged.
- `setNodeTransform(nodeId, transform)` — replaces an assembly expansion's local
  placement transform and recomposes world transforms for that node's subtree
  only. O(|subtree|): proportional to the descendant nodes and instances under
  the moved placement, not the whole model. Sibling branches and the other
  expansions of a repeated assembly retain their existing values.

Both return a `TransformDelta` (`changedInstanceIds` ascending + `valid`) and
treat a value identical to the current local transform as a no-op (empty delta,
no recomputation). Instance slots, visibility bits, and draw ordering are never
touched by transform edits, so `getDrawList()` stays deterministic and
`VisibilityDelta`s remain consistent. Hidden instances keep valid world
transforms so they render correctly when shown later.

The internal runtime maintains both slot → handle and handle → slot maps. This
lets
the [[rendering/renderer-subrange-updates|renderer]] map interaction state and pick hits
back to slots.

## Design notes

- One compiled node per assembly _expansion_, so an assembly placed multiple
  times becomes multiple nodes with independent subtrees.
- `Scene.build()` now validates references and cycles, so the runtime assumes
  valid input but still skips missing assemblies defensively.
- The typed arrays are read-only views; mutating them desynchronizes
  `visibleCount`.

Visibility deltas are now wired to GPU subrange updates in the
[[rendering/renderer-subrange-updates|renderer]].

Related: [[engineering/performance-issues|Performance issues and risks]].

[engineering/performance-issues|Performance issues and risks]: ../engineering/performance-issues.md
[rendering/renderer-subrange-updates|renderer]: ../rendering/renderer-subrange-updates.md
