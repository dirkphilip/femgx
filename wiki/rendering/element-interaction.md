# Element-level interaction

Element selection, highlighting, and picking build on the part/instance system
(see [[rendering/interactive-state|Interactive state]] and [[rendering/pick-format|Pick texture
format]]) without regressing it. Elements are the unit of FE-feature selection
(e.g. a shell or a stiffener), while instances stay the unit of instancing.

## Stable element ids

- `Geometry` optionally declares `ElementTessellation` descriptors: a stable
  `id` plus the contiguous logical-primitive range that tessellates the element
  in the part's index buffer. Every primitive kind uses the same
  (`primitiveStart`, `primitiveCount`) contract
  ([[data/elements-topology|Element topology]]).
- `validateElements` enforces that, when declared, every logical primitive
  belongs to exactly one element and ids are unique. Parts without descriptors
  are not element-pickable and every primitive reports "no element".
- The GPU pick map stores `elementId + 1` per logical primitive (`0` = none), so the
  id `0` collision with "no element" is avoided; `buildElementPrimitivePickIds`
  mirrors the CPU descriptor exactly.

## Picking

- The pick pass renders four attachments: the instance, element, face, and
  node pick ids (`pickFragmentShader` writes all four). All use the
  `rgba8unorm` packing of [[rendering/pick-format|pick-format]] (see
  [[rendering/node-face-interaction|node and face interaction]]).
- `readPickPixel` copies all attachments into one pooled readback buffer and
  decodes the ids; the private resolver turns a hit into the deepest physical
  target the ids support (`node` > `face` > `element` > `instance`). A
  `PickHit` therefore distinguishes `part`, `instance`, `element`, `face`,
  and `node`.
- The demo and library share one pick path: the renderer's asynchronous
  `pick(x, y)` GPU readback (see
  [[rendering/fe-inspection-workbench|FE inspection workbench]] and
  [[rendering/node-face-interaction|node and face interaction]]). Hover/
  selection keys are prefixed by granularity (`n:instance:node`,
  `f:instance:element:faceKey`, `e:instance:element`, `i:instance`, `p:part`).

## Interaction state and precedence

- `InteractionState` adds `highlightedElementIds` and `selectedElementIds` (per
  instance), `hoveredElement`, and `elementOverrides`.
- `resolveElementStyle` resolves the instance style first, then applies element
  highlight, hover, selection, and an explicit element override. Element state
  beats instance/part state; selection beats hover; explicit overrides win last.
- `emphasizedElementRefs` collects every emphasized occurrence (highlighted,
  hovered, selected, or overridden) in deterministic order with no duplicates.

## GPU emphasis without material clones

- Each part storage has a growable `ElementHighlights` storage buffer
  (records at `ELEMENT_RECORD_STRIDE` bytes, initially `INITIAL_ELEMENT_HIGHLIGHTS`
  records) that the color vertex shader scans per logical primitive: a record
  matching the part-local slot and the primitive's element pick id overrides
  color and emissive. Emphasis therefore never clones materials or rebuilds
  geometry.
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
  instance's deduplicated mesh edges (`buildMeshEdgeData`) as a line overlay on
  top of its solid surface pass — so a wireframe look does not hide the solid
  fill underneath. FE edges are deduplicated by their authored node ids, so
  tessellation vertices and quadratic mid-edge segments do not create duplicate
  lines or triangulation diagonals.
- The overlay is addressed by a second compacted per-part draw-order list (the
  **edge order**, `writeEdgeOrder`), a subset of the surface draw order holding
  only the edge-styled visible slots. `updateInstances` tracks which parts'
  edge membership flipped (via a CPU edge-flag mirror) and rewrites only those
  parts' edge orders; visibility deltas rebuild both orders for the affected
  parts. The edge pass uses a second cached bind group per part that addresses
  the edge order buffer.
- The overlay draws with depth writes off and `depthCompare` selected by
  `FemViewport.setEdgeDepthTest`: on (default) uses `less` so edges
  occluded by nearer geometry are culled; off uses `always` so every edge shows
  through the model. Two line-list pipelines are pre-created in
  `gpu-pipelines.ts`.
- Element edges use translucent neutral black rather than inheriting each
  part's fill color, so topology stays readable without obscuring the model.
- Edge and node topology records carry all owning body ids. A topology record is
  drawn when it is unowned or at least one owner is visible; it is hidden only
  when every owner is hidden. This makes body visibility consistent for filled
  faces, derived edges, and node glyphs, including shared topology, without
  cloning geometry or materials.
- The demo drives the overlay by applying an `{ edge: true }` part override to
  every part (`Edge overlay` toggle) and flips the overlay depth compare with
  the `Depth test` toggle (see
  [[rendering/fe-inspection-workbench|FE inspection workbench]]).
- The edge pass renders instance-level style only; per-element emphasis is not
  drawn on edges because edges shared between adjacent elements have no
  unambiguous element owner.

## Limits and follow-ups

- Element emphasis renders as an emissive glow in the WebGPU color pass; the
  WebGPU e2e pixel assertion (see
  [[rendering/webgpu-e2e|WebGPU browser e2e lane]]) covers it in a real browser.
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

[data/elements-topology|Element topology]: ../data/elements-topology.md
[rendering/fe-inspection-workbench|FE inspection workbench]: fe-inspection-workbench.md
[rendering/interactive-state|Interactive state]: interactive-state.md
[rendering/node-face-interaction|node and face interaction]: node-face-interaction.md
[rendering/pick-format|pick-format]: pick-format.md
[rendering/webgpu-e2e|WebGPU browser e2e lane]: webgpu-e2e.md
