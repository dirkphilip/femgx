# Packed scene runtime

The runtime (issue #3) compiles the authoring [[architecture-overview|scene
model]] into a packed, typed-array representation with delta-oriented
visibility updates.

## What it provides

`createSceneRuntime(scene)` (in `src/scene-runtime/`) returns a `SceneRuntime`
that stores, in typed arrays indexed by stable **instance id**:

- world transforms (`instanceWorldTransforms`, 16 floats per instance),
- local placement transforms (`instanceLocalTransforms`) and composed node
  transforms (`nodeLocalTransforms`/`nodeWorldTransforms`, 16 floats each),
- part references (`instancePartIds`),
- a compiled assembly tree (`nodeParents`, `nodeFirstChild`, `nodeNextSibling`)
  with per-node authoring/effective visibility, and
- per-instance visibility bits (`instanceVisible`) plus a contiguous subtree
  instance range per node (`nodeInstanceStart/End`).

Instance ids are slots over the **full** depth-first placement list, including
currently hidden placements, so they never change when visibility changes. This
decouples the stable pick identity from the compacted draw list. This is the
packed counterpart of `flattenAssembly`'s path-derived `InstanceId` strings
(`src/runtime/compile.ts` compiles per-frame snapshots; the scene runtime keeps
persistent packed state and updates it in place).

## Visibility deltas

Updates apply immediately and return a `VisibilityDelta`:

- `setPartVisible(partId, visible)` — flips the authoring part flag of that
  part's instance slots.
- `setAssemblyVisible(assemblyId, visible)` — flips node authoring visibility
  and recomputes the affected subtree (short-circuits when effective visibility
  is unchanged).
- `setInstanceVisible(instanceId, visible)` — per-slot override.

Effective visibility is `instanceOverride && partVisible && every ancestor node
visible` (bottom-up inheritance, unchanged from the authoring model). Hiding an
ancestor hides everything beneath it; showing a descendant cannot override a
hidden ancestor. Updates touch only the affected instance slots and report the
changed ids plus before/after `visibleCount`; geometry and the instance list are
never rebuilt.

`getDrawList()` returns the visible instance ids in deterministic depth-first
order (matching `[[instancing-strategy|flattenAssembly]]` ordering).

## Transform updates

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

`getInstanceId(slot)` resolves a stable instance slot back to its authoring
placement handle (the same path strings `flattenAssembly` derives), which lets
the [[renderer-subrange-updates|renderer]] map interaction state and pick hits
back to slots.

## Design notes

- One compiled node per assembly _expansion_, so an assembly placed multiple
  times becomes multiple nodes with independent subtrees.
- `Scene.build()` now validates references and cycles, so the runtime assumes
  valid input but still skips missing assemblies defensively, mirroring
  `flattenAssembly`.
- The typed arrays are read-only views; mutating them desynchronizes
  `visibleCount`.
- The compile walk is recursive (as `flattenAssembly` was before #4); scenes
  are validated acyclic so this is safe, but an iterative compile would match
  the post-#4 flatten walk for deeply nested models.

## Future work

- Make the compile walk iterative (see Design notes).

Visibility deltas are now wired to GPU subrange updates in the
[[renderer-subrange-updates|renderer]].

Related: [[performance-issues|Performance issues and risks]].
