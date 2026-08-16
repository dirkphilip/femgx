# Renderer subrange updates

The renderer wires the [[architecture/packed-runtime|packed runtime]]'s visibility/transform
deltas into direct GPU subrange writes, so interactive updates touch only the
changed placements instead of rebuilding instance data.

## Per-part storage

Each attached part currently owns one instance-record buffer, six compact order
buffers, and one emphasis/selection buffer
(`src/renderer/resources/instance-storage.ts`):

- **Record buffer** (`binding 0`): one 96-byte record per slot — column-major
  world transform (16 floats), resolved color with opacity folded into alpha
  (4 floats), a stable pick id, and an emissive scalar that drives the
  hover/highlight glow in the fragment shader. Field offsets are documented on
  `EMISSIVE_BYTE_OFFSET` in `src/renderer/resources/instance-storage.ts` and mirrored by the
  `Instance` struct in `src/renderer/shaders/scene.ts`. The buffer is indexed by
  the **part-local slot** (`runtime-state.ts` maps global instance slots to
  part-local slots once at attach), so slot `N` always lives at byte `N * 96`
  and never moves.
- **Draw-order buffer** (`binding 1`): the compacted list of that part's visible
  part-local slots in ascending draw order. The vertex shader reads
  `instances[drawOrder[instanceIndex]]`, so hidden slots are never drawn and the
  draw is `drawIndexed(geometry, visibleCountOfPart)`.
- **Optional-path order buffers**: separate compacted lists for transparency,
  visible/hidden selection, selected nodes, edge presentation, and node
  presentation. The current implementation allocates all six orders at part
  capacity. This is an implementation gap against the zero-inactive-cost
  contract: #1008 moves non-ordinary orders and emphasis storage into lazy
  sidecars backed by fixed shared empty resources.
- **Emphasis/selection buffer**: sparse fixed-stride records plus optional dense
  ordinal bitsets. Small exception sets remain sparse; dense membership is used
  only when its byte representation is smaller.

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
- `writeNodeOrder(partId, order)` applies the same compacted update discipline
  to resolved part/instance node membership. Point parts receive an empty node
  order because their primary point draw already represents the node.
- Steady-state `render(runtime, camera, parts)` reuses cached buffers and issues
  zero instance writes.

## Part geometry ownership

The reusable surface upload keeps the authoritative expanded draw positions in
one buffer with both `VERTEX` and `STORAGE` usage. Vertex shaders read that same
buffer for deformed node-pick corner positions; binding 5 carries topology plus
compact primitive and edge ids, and binding 7 addresses the selected position
buffer.
This avoids copying every expanded position into a second packed storage buffer.

Primitive ids preserve face-subset remapping. Face/body ownership and neighbor
conditions remain in compact topology storage, where face ranges can share one
retained record across all of a face's triangles. Subset surface positions use
cached subset buffers; placements never receive geometry or topology copies.

Presentation edge endpoints and topology are materialized only on first edge
display. Exact wider edge-pick geometry is a separate lazy resource created only
when edge granularity is requested. Repeated placements share both resources by
part, and leaving presentation enabled never implies exact edge-pick residency.

## Design notes

- Visibility is expressed entirely by the draw-order buffer; hiding/showing
  never rewrites record buffers.
- `attach` rebuilds packed instance/layout state for each runtime identity, but
  retains geometry and optional per-part resources for unchanged `Part` object
  identities. A changed or removed part releases its cached resources through
  `RendererAttachment` in `src/renderer/attachment.ts`; per-placement instance
  and order buffers are replaceable. Transform, visibility, interaction,
  deformation, and highlight changes within the attached runtime remain
  subrange-oriented.
- Style/transform/visibility updates are explicit: the app applies a runtime
  delta (or interaction change) and passes the affected slots. The renderer
  does not rescan the whole scene per frame.
- Interaction changes reach the renderer through the viewport helper
  `changedInstanceSlots(runtime, previous, next)`
  (`src/viewport/interaction-diff.ts`), which diffs the part/instance-level
  interaction state against the previous state and returns the affected
  instance slots in ascending order. Body/element/node/face emphasis is excluded —
  it flows through `updateElements`, which diffs its own buffers. The demo
  tracks the last-applied interaction state and feeds these slots to
  `updateInstances` instead of rewriting every instance
  ([[architecture/demo-library-boundary|Demo / library boundary]]). After a
  device-loss recovery or renderer re-creation the attachment re-uploads from
  an empty interaction state, so the caller must reset its applied-state
  baseline to empty before the next diff.
- `updateInstances` detects visibility changes by comparing the runtime's total
  visible count against the cached layout count. Batching several visibility
  deltas whose net count is unchanged (e.g. hiding one slot and showing another)
  into a single `updateInstances` call can skip the draw-order rebuild and leave
  a hidden slot drawn; follow the one-`updateInstances`-per-delta flow until
  per-part visibility tracking replaces the global-count heuristic.
- Ordinary, transparent, edge, node, selection, node-selection, and face-subset
  bind groups are cached per part/storage variant and invalidated when their
  referenced buffers are replaced or grown. The edge-pick path intentionally
  creates its request-specific bind group for each batch. #1008 makes inactive
  optional orders fixed-empty instead of capacity-sized; #1009 then admits
  minimal/topology/feature shader layouts without duplicating geometry.
- The WGSL record structs (`Instance`, `ElementHighlight`, `ElementHighlights`,
  `Camera`) are verified against the CPU encoder constants (`INSTANCE_STRIDE`,
  `ELEMENT_RECORD_STRIDE`, `HIGHLIGHT_HEADER`, `CAMERA_UNIFORM_SIZE`) by
  parsing the exported shader sources with `wgsl_reflect` in
  `test/renderer/shaders/scene.test.ts`. A `vec3` member or any other alignment
  trap now fails unit tests instead of silently desyncing CPU/GPU records.

Related: [[architecture/packed-runtime|packed runtime]],
[[rendering/interactive-state|Interactive state]].

[architecture/demo-library-boundary|Demo / library boundary]: ../architecture/demo-library-boundary.md
[architecture/packed-runtime|packed runtime]: ../architecture/packed-runtime.md
[rendering/element-interaction|Element-level interaction]: element-interaction.md
[rendering/interactive-state|Interactive state]: interactive-state.md
