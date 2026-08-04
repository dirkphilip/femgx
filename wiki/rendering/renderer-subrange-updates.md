# Renderer subrange updates

The renderer wires the [[architecture/packed-runtime|packed runtime]]'s visibility/transform
deltas into direct GPU subrange writes, so interactive updates touch only the
changed placements instead of rebuilding instance data.

## Per-part storage

Each part owns three storage buffers (`src/renderer/gpu-draw.ts`):

- **Record buffer** (`binding 0`): one 96-byte record per slot — column-major
  world transform (16 floats), resolved color with opacity folded into alpha
  (4 floats), a stable pick id, and an emissive scalar that drives the
  hover/highlight glow in the fragment shader. Field offsets are documented on
  `EMISSIVE_BYTE_OFFSET` in `src/renderer/gpu-draw.ts` and mirrored by the
  `Instance` struct in `src/renderer/gpu-shaders.ts`. The buffer is indexed by
  the **part-local slot** (`runtime-state.ts` maps global instance slots to
  part-local slots once at attach), so slot `N` always lives at byte `N * 96`
  and never moves.
- **Draw-order buffer** (`binding 1`): the compacted list of that part's visible
  part-local slots in ascending draw order. The vertex shader reads
  `instances[drawOrder[instanceIndex]]`, so hidden slots are never drawn and the
  draw is `drawIndexed(geometry, visibleCountOfPart)`.
- **Edge-order buffer**: a second compacted list holding the visible slots whose
  resolved style requests the line overlay (see
  [[rendering/element-interaction|Element-level interaction]]). The overlay pass addresses
  it through a second cached bind group per part, so only edge-styled instances
  are drawn as lines while their surface pass keeps drawing everything visible.

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
- `writeEdgeOrder(partId, order)` rewrites only the affected edge orders: the
  renderer keeps a CPU edge-flag mirror per slot and rebuilds a part's edge
  order only when its membership flips or its visibility changes.
- Steady-state `render(runtime, camera, parts)` reuses cached buffers and issues
  zero instance writes.

## Design notes

- Visibility is expressed entirely by the draw-order buffer; hiding/showing
  never rewrites record buffers.
- `attach` runs once per runtime and then grows in place when the same scene
  appends parts/instances (a chunked model). A fresh runtime that is a
  compatible superset (instances are only appended, existing slots keep their
  part and placement identity) uploads only the delta — the new part's geometry
  and the appended instance records — via `RendererAttachment` in
  `src/renderer/attachment.ts`. Any other change (shrink, reordering, identity
  shift) falls back to a full rebuild (see
  [[data/large-model-streaming|Large-model streaming]]).
- Style/transform/visibility updates are explicit: the app applies a runtime
  delta (or interaction change) and passes the affected slots. The renderer
  does not rescan the whole scene per frame.
- `updateInstances` detects visibility changes by comparing the runtime's total
  visible count against the cached layout count. Batching several visibility
  deltas whose net count is unchanged (e.g. hiding one slot and showing another)
  into a single `updateInstances` call can skip the draw-order rebuild and leave
  a hidden slot drawn; follow the one-`updateInstances`-per-delta flow until
  per-part visibility tracking replaces the global-count heuristic.
- Bind groups are still created per batch per frame (see
  [[engineering/performance-issues|performance risks]]); only the record and order buffers
  are persistent.
- The WGSL record structs (`Instance`, `ElementHighlight`, `ElementHighlights`,
  `Camera`) are verified against the CPU encoder constants (`INSTANCE_STRIDE`,
  `ELEMENT_RECORD_STRIDE`, `HIGHLIGHT_HEADER`, `CAMERA_UNIFORM_SIZE`) by
  parsing the exported shader sources with `wgsl_reflect` in
  `test/renderer/gpu-shaders.test.ts`. A `vec3` member or any other alignment
  trap now fails unit tests instead of silently desyncing CPU/GPU records.

Related: [[architecture/instancing-strategy|Instancing strategy]], [[rendering/interactive-state|Interactive state]].
