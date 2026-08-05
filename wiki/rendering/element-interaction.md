# Element-level interaction

Element selection, highlighting, and picking build on the part/instance system
(see [[rendering/interactive-state|Interactive state]] and [[rendering/pick-format|Pick texture
format]]) without regressing it. Elements are the unit of FE-feature selection
(e.g. a shell or a stiffener), while instances stay the unit of instancing.

## Stable element ids

- `Geometry` optionally declares `ElementTessellation` descriptors: a stable
  `id` plus the contiguous triangle range (`triangleStart`, `triangleCount`)
  that tessellates the element in the part's index buffer
  ([[data/elements-topology|Element topology]]).
- `validateElements` enforces that, when declared, every triangle belongs to
  exactly one element and ids are unique. Parts without descriptors are not
  element-pickable and every triangle reports "no element".
- The GPU pick map stores `elementId + 1` per triangle (`0` = none), so the
  id `0` collision with "no element" is avoided; `buildElementTrianglePickIds`
  mirrors the CPU descriptor exactly.

## Picking

- The pick pass renders four attachments: the instance, element, face, and
  node pick ids (`pickFragmentShader` writes all four). All use the
  `rgba8unorm` packing of [[rendering/pick-format|pick-format]] (see
  [[rendering/node-face-interaction|node and face interaction]]).
- `readPickPixel` copies all attachments into one pooled readback buffer and
  decodes the ids; `resolvePickTarget` turns a hit into the most specific
  target the ids support (`node` > `face` > `element` > `instance`). A
  `PickTarget` therefore distinguishes `part`, `instance`, `element`, `face`,
  and `node`.
- The demo uses CPU raycasting for both renderers instead of GPU readback
  (see [[rendering/fe-inspection-workbench|FE inspection workbench]]): the unified
  `pick()` resolves the most specific target (node → face → element), and
  hover/selection keys are prefixed by granularity (`n:instance:node`,
  `f:instance:element:faceKey`, `e:instance:element`, `i:instance`,
  `p:part`). `pickFromRay` is the renderer-independent CPU analogue of the GPU
  pick target resolution (see [[rendering/node-face-interaction|node and face interaction]]).

## Interaction state and precedence

- `InteractionState` adds `selectedElementIds` (per instance), `hoveredElement`,
  and `elementOverrides`.
- `resolveElementStyle` resolves the instance style first, then applies element
  hover, element selection, then an explicit element override. Element state
  beats instance/part state; selection beats hover; explicit overrides win last.
- `emphasizedElementRefs` collects every emphasized occurrence (hovered,
  selected, or overridden) in deterministic order with no duplicates.

## GPU emphasis without material clones

- Each part storage has a growable `ElementHighlights` storage buffer
  (records at `ELEMENT_RECORD_STRIDE` bytes, initially `INITIAL_ELEMENT_HIGHLIGHTS`
  records) that the color vertex shader scans per triangle: a record matching
  the part-local slot and the triangle's element pick id overrides color and
  emissive. Emphasis therefore never clones materials or rebuilds geometry.
- `syncElementHighlights` maps emphasized refs to per-part records
  (`collectEmphasisUpdates`), dropping refs whose instance is not in the
  layout (e.g. hidden or stale), and `writeElementHighlights` diffs against a
  CPU mirror so only changed byte subranges reach the GPU. When an emphasis list
  outgrows a part's buffer it is recreated larger (doubling from the initial
  capacity), the old buffer is destroyed, and the cached bind group invalidated
  so the next draw binds the larger buffer — records are never silently dropped.
  The same buffer also carries face and node emphasis records (see
  [[rendering/node-face-interaction|node and face interaction]]).
- The WGSL `ElementHighlights` struct declares `records` as a runtime-sized
  `array<ElementHighlight>`, so the buffer size is a CPU-side concern: the
  shader scans exactly `count` records regardless of capacity.
- WGSL alignment trap: `vec3<T>` aligns to 16 bytes, so a `vec3` struct member
  forces a 64-byte `ElementHighlight` stride and pushes the header padding of
  `ElementHighlights` to 16 bytes (records to 32). Keep the CPU/GPU record
  layout in sync: the element structs must not use `vec3` members. The layout
  tests in `test/renderer/gpu-shaders.test.ts` parse the shader with
  `wgsl_reflect` and assert every record struct's member offsets and stride
  against the CPU encoder constants, so a `vec3`-style desync fails in CI
  instead of silently misrendering.

## Edge overlay

- `StyleOverride` supports an `edge` flag (part- or instance-level). When the
  resolved style of a visible instance requests it, the renderer draws that
  instance's deduplicated mesh edges (`buildMeshEdges`) as a line overlay on
  top of its solid surface pass — so a wireframe look does not hide the solid
  fill underneath.
- The overlay is addressed by a second compacted per-part draw-order list (the
  **edge order**, `writeEdgeOrder`), a subset of the surface draw order holding
  only the edge-styled visible slots. `updateInstances` tracks which parts'
  edge membership flipped (via a CPU edge-flag mirror) and rewrites only those
  parts' edge orders; visibility deltas rebuild both orders for the affected
  parts. The edge pass uses a second cached bind group per part that addresses
  the edge order buffer.
- The overlay draws with depth writes off and `depthCompare` selected by
  `WebGpuRenderer.setEdgeDepthTest`: on (default) uses `less-equal` so edges
  occluded by nearer geometry are culled; off uses `always` so every edge shows
  through the model. Two line-list pipelines are pre-created in
  `gpu-pipelines.ts`.
- The demo drives the overlay by applying an `{ edge: true }` part override to
  every part (`Edge overlay` toggle) and flips the overlay depth compare with
  the `Depth test` toggle. Depth-tested edges are a WebGPU-only pass, so the
  CPU fallback disables and annotates that control instead of advertising a
  no-op (see [[rendering/fe-inspection-workbench|FE inspection workbench]]).
- The edge pass renders instance-level style only; per-element emphasis is not
  drawn on edges because edges shared between adjacent elements have no
  unambiguous element owner.

## Limits and follow-ups

- Element-highlight buffers grow on demand, so there is no fixed per-part
  element-selection cap; the vertex shader scans every record per triangle, so
  selections on the order of the whole model (or every element across many
  instances of one part) can cost draw time and GPU memory (the buffer is bounded
  by `maxStorageBufferBindingSize`). Very large selections are a performance
  concern, not a correctness one (resolved in
  [femgx#68](https://github.com/dirkphilip/femgx/issues/68); the linear scan is
  tracked in [femgx#95](https://github.com/dirkphilip/femgx/issues/95)).
- The edge overlay draws instance-level emphasis, not per-element edges, because
  edges shared between adjacent elements have no unambiguous element owner.
