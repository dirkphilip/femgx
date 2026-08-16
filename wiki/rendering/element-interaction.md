# Element-level interaction

Element selection, highlighting, and picking build on the part/instance system
(see [[rendering/interactive-state|Interactive state]] and [[rendering/pick-format|Pick texture
format]]) without regressing it. Elements are the unit of FE-feature selection
(e.g. a shell or a stiffener), while instances stay the unit of instancing.

## Stable element ids

- A `Part` optionally declares `ElementTessellation` descriptors: a stable
  `id` plus one or more logical-primitive ranges that tessellate the element
  across its homogeneous geometry groups. Every range qualifies the same
  (`primitiveStart`, `primitiveCount`) contract with its primitive kind
  ([[data/elements-topology|Element topology]]).
- `createPart` enforces that, when declared, every logical primitive in each
  geometry group belongs to exactly one element range and ids are unique. Parts
  without descriptors are not element-pickable and every primitive reports
  "no element".
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
  target the ids support (`node` > `face` > `element` > `instance`). Hosts can
  promote any `PickHit` to a part target through `interactionTargetFromHit`;
  a physical hit itself is never reported as `kind: "part"`.
- Optional body-aware geometry carries body owner ids alongside element ids in
  primitive, face, edge, and node ownership records. Bodyless geometry omits
  model-scaled body ownership data.
- The demo and library share one pick path: the renderer's asynchronous
  `pick(x, y)` GPU readback, or `pick(x, y, "edge")` for authored-edge
  granularity (see
  [[rendering/fe-inspection-workbench|FE inspection workbench]] and
  [[rendering/node-face-interaction|node and face interaction]]). Hover/
  selection keys are prefixed by granularity (`n:instance:node`,
  `f:instance:element:faceIndex`, `e:instance:element`, `ed:instance:key`,
  `i:instance`, `p:part`).

## Interaction state and precedence

- `resolveElementStyle` resolves instance, body, and element styles in that
  order, then applies highlight, hover, selection, and an explicit override at
  the most specific layer. Element state beats body/instance/part state;
  selection beats hover; explicit overrides win last.
- `emphasizedElementRefs` collects every emphasized occurrence (highlighted,
  hovered, selected, overridden, or hidden) in deterministic order with no
  duplicates. Hidden elements remain selected/highlighted in host state, but
  the renderer marks their GPU record hidden and excludes them from color,
  transparency, deformation, and picking.

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
  tests in `test/renderer/shaders/scene.test.ts` parse the shader with
  `wgsl_reflect` and assert every record struct's member offsets and stride
  against the CPU encoder constants, so a `vec3`-style desync fails in CI
  instead of silently misrendering.

## Edge overlay

- `StyleOverride` supports an `edge` flag at the part or instance layer. Body,
  element, face, and node layers reject it because the GPU has no unambiguous
  primitive-owned edge representation. When the
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
- Node annotations use the same instance-order mechanism: the resolved
  `nodes` flag creates a compacted per-part node order and a node draw call.
  Point parts are excluded because their primary point sprites already draw
  their authored nodes; node order membership is not a per-element filter.
- The overlay draws with depth writes off and `depthCompare` selected by
  `FemViewport.setEdgeDepthTest`: on (default) uses `less-equal` so edges
  occluded by nearer geometry are culled; off uses `always` so every edge shows
  through the model. Two edge pipelines are pre-created in
  `renderer/frame/pipelines.ts`.
- Element edges use translucent neutral black rather than inheriting each
  part's fill color, so topology stays readable without obscuring the model.
- Edge overlays inherit the resolved instance alpha, so their neutral black is
  also transparent when a part or instance has fractional opacity. Alpha-zero
  edges contribute no color while remaining available to the normal GPU pick
  path.
- Edge and node topology records carry paired owner/neighbor body and element
  conditions when bodies are authored. Volume geometry retains all oriented faces and their
  neighbor element ids; the GPU predicate suppresses a coincident interior
  face when both owners are visible and exposes the surviving oriented face
  when the other owner is hidden. The same predicate drives filled faces,
  depth, picking, deformation, transparency, edges, and node glyphs, without
  cloning geometry or materials. Parts retain the compact direct body/element
  topology layout.
- The workbench drives the overlay by applying an `{ edge: true }` part
  override to every part. Hosts control occlusion through the public
  `FemViewport.setEdgeDepthTest` method; the workbench keeps the shipped
  depth-tested edge policy.
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
- Semantic element blocks and block-granularity interaction are removed. Their
  public targets and GPU fields do not exist, including compatibility aliases.
- The edge overlay draws instance-level emphasis, not per-element edges, because
  edges shared between adjacent elements have no unambiguous element owner.

[data/elements-topology|Element topology]: ../data/elements-topology.md
[rendering/fe-inspection-workbench|FE inspection workbench]: fe-inspection-workbench.md
[rendering/interactive-state|Interactive state]: interactive-state.md
[rendering/node-face-interaction|node and face interaction]: node-face-interaction.md
[rendering/pick-format|pick-format]: pick-format.md
[rendering/webgpu-e2e|WebGPU browser e2e lane]: webgpu-e2e.md
