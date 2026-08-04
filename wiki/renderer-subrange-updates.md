# Renderer subrange updates

The renderer wires the [[packed-runtime|packed runtime]]'s visibility/transform
deltas into direct GPU subrange writes, so interactive updates touch only the
changed placements instead of rebuilding instance data.

## Per-part storage

Each part owns two storage buffers (`src/renderer/gpu-draw.ts`):

- **Record buffer** (`binding 0`): one 96-byte record per slot — column-major
  world transform (16 floats), resolved color with opacity folded into alpha
  (4 floats), and a stable pick id. The buffer is indexed by the **part-local
  slot** (`runtime-state.ts` maps global instance slots to part-local slots once
  at attach), so slot `N` always lives at byte `N * 96` and never moves.
- **Draw-order buffer** (`binding 1`): the compacted list of that part's visible
  part-local slots in ascending draw order. The vertex shader reads
  `instances[drawOrder[instanceIndex]]`, so hidden slots are never drawn and the
  draw is `drawIndexed(geometry, visibleCountOfPart)`.

Pick ids are `global slot + 1`, so they are **stable across visibility changes**;
`pick()` resolves a readback id through the runtime's `getInstanceId(slot)`.

## Update path

`WebGpuRenderer.updateInstances(runtime, interaction, changedInstanceIds)`:

- `patchInstances(partId, updates)` re-encodes the changed slots' records and
  writes only the byte subranges whose bytes actually changed (coalescing
  adjacent changed slots), keeping a CPU mirror in sync.
- `writeDrawOrder(partId, order)` rewrites only the changed u32 subranges of the
  part's compacted draw order. A visibility delta rebuilds the order list only
  for the affected parts (`runtime-state.ts` `buildDrawOrder`).
- Steady-state `render(runtime, camera, parts)` reuses cached buffers and issues
  zero instance writes.

## Design notes

- Visibility is expressed entirely by the draw-order buffer; hiding/showing
  never rewrites record buffers.
- `attach` runs once per runtime (keyed by object identity); re-attaching (e.g.
  a fresh `createSceneRuntime`) rebuilds buffers, so apps should reuse one
  runtime per scene.
- Style/transform/visibility updates are explicit: the app applies a runtime
  delta (or interaction change) and passes the affected slots. The renderer
  does not rescan the whole scene per frame.
- Bind groups are still created per batch per frame (see
  [[performance-issues|performance risks]]); only the record and order buffers
  are persistent.

Related: [[instancing-strategy|Instancing strategy]], [[interactive-state|Interactive state]].
