# Packed scene runtime

The runtime (issue #3) compiles the authoring [[architecture-overview|scene
model]] into a packed, typed-array representation with delta-oriented
visibility updates.

## What it provides

`createSceneRuntime(scene)` (in `src/scene-runtime/`) returns a `SceneRuntime`
that stores, in typed arrays indexed by stable **instance id**:

- world transforms (`instanceWorldTransforms`, 16 floats per instance),
- part references (`instancePartIds`),
- a compiled assembly tree (`nodeParents`, `nodeFirstChild`, `nodeNextSibling`)
  with per-node authoring/effective visibility, and
- per-instance visibility bits (`instanceVisible`) plus a contiguous subtree
  instance range per node (`nodeInstanceStart/End`).

Instance ids are slots over the **full** depth-first placement list, including
currently hidden placements, so they never change when visibility changes. This
decouples the stable pick identity from the compacted draw list. This is the
packed counterpart of `flattenAssembly`'s path-derived `InstanceId` strings
(`src/runtime.ts` compiles per-frame snapshots; the scene runtime keeps
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

- Cache the draw list and turn delta id lists into byte ranges for GPU buffer
  subrange patching (see [[interactive-state|Interactive state]]).
- Make the compile walk iterative (see Design notes).

Related: [[performance-issues|Performance issues and risks]].
