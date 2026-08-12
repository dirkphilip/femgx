# Node and face picking and selection

Node and face interaction build on element interaction (see
[[rendering/element-interaction|Element-level interaction]]) with the same
renderer-independent identity and delta-driven emphasis guarantees. Nodes and
oriented element faces are the finest-grained pickable units under
[[rendering/interactive-state|Interactive state]].

## Stable identities

- **Nodes**: `NodeId` already indexes `ElementModel.nodes` densely. The
  tessellation records a `nodePickIds` array (one `u32` per mesh vertex,
  `nodeId + 1`) plus `nodePositions` (per `NodeId`, three floats) so picks
  resolve to local/world positions on the CPU. Supported element tessellation
  emits authored nodes only; `0` remains reserved for node-less custom geometry.
- **Faces**: `facesOfElement` pairs every `facesOf(element)` result with a
  stable `faceIndex` (canonical order). The tessellation assigns each oriented
  face a part-local `FaceTessellation` (stable `id`, `elementId`,
  `faceIndex`, canonical `key`, node loop, `neighborElementIds`) and writes a
  per-triangle `facePickIds` map (`faceId + 1`, `0` = no face).
- `Geometry` carries `nodePickIds`, `nodePositions`, `facePickIds`, and
  `faces`; `validatePickIds` enforces the per-vertex/per-triangle lengths and
  that face ids are dense. GPU pick readback resolves from the same part
  geometry, so ids stay stable across culling and compaction.

## Picking

- The GPU pick pass now renders **four** `rgba8unorm` attachments: instance,
  element, face, and node ids (see [[rendering/pick-format|Pick texture format]]).
  `readPickPixel` copies all four into one pooled readback buffer.
- Triangle geometry feeds the per-triangle element/face ids and per-vertex
  node ids; a dedicated `nodePickVertexShader`/`nodePickFragmentShader`
  (triangle pick pipeline) passes each triangle's three corner positions and
  node ids as flat varyings plus the interpolated local position, and the
  fragment reports the node id of the nearest corner only when the hit is
  close enough to that corner (relative to the triangle's longest edge);
  otherwise the node attachment stays 0 so face interiors resolve as faces.
  The corner positions are read from a tightly packed `array<f32>` (3 floats
  per vertex),
  not `array<vec3<f32>>` — a vec3 storage array strides at 16 bytes, which
  would misalign the packed `positions` buffer. Lines and points report
  element/face/node = 0.
- `resolvePickTarget(context, ids, granularity)` returns the most specific
  level the hit supports (`node` > `face` > `element` > `instance` > `part`).
  Passing a `granularity` promotes/narrows the hit to that level, falling back
  to the deepest available when a deeper level is requested. Node targets carry
  local/world position and geometry-derived adjacency; face targets carry the
  oriented node loop, world-space normal, neighbor elements, and a hit position
  (the face centroid for rasterized picks).

## Interaction state and emphasis

- `InteractionState` adds `selectedNodeIds`, `highlightedNodeIds`,
  `hoveredNode`, `selectedFaces` (per instance, mapping `FaceKey` to the owning
  `ElementId`), `highlightedFaces`, and `hoveredFace` (see
  `interaction/nodes.ts`, `interaction/faces.ts`, and `interaction/refs.ts`).
- `resolveNodeStyle`/`resolveFaceStyle` apply the same precedence as element
  state (highlight < hover < selection, all above part/instance).
- GPU emphasis reuses the generalized per-part emphasis buffer: a record now
  carries exactly one of `elementPickId`, `facePickId`, or `nodePickId`. The
  surface shader matches element records against the per-triangle element id
  and face records against the per-triangle face id. It deliberately ignores
  node records, so selecting a node never recolors its incident faces or draws
  overlapping highlight geometry.
- The bounded per-part emphasis capacity documented in
  [[rendering/element-interaction|element-interaction]] applies to node/face records too
  (tracked in [femgx#68](https://github.com/dirkphilip/femgx/issues/68)).
- The demo renders node/face emphasis through the library
  `emphasizedNodeRefs`/`emphasizedFaceRefs` plus `resolveNodeStyle`/
  `resolveFaceStyle`; it does not derive element overrides from node/face
  state ([[architecture/demo-library-boundary|Demo / library boundary]]).

## Node glyph overlay

- The demo's `Show element nodes` control draws one small screen-space circle
  for every visible FE node. Annotation circles are 6 CSS pixels in diameter
  (three-quarters of the regular point-element diameter), scaled by
  `devicePixelRatio` so they stay the same apparent size on Retina and 1×
  displays. Their default color is black, independent of the part palette. The
  pass reuses generated per-node quads; it does not introduce a second copy of
  surface geometry.
- Node circles draw after surfaces in the same multisampled pass with normal
  `less-equal` depth testing and depth writes disabled. Occluded circle samples
  stay hidden while visible front nodes remain at exact model depth; there is
  no geometric depth offset and no second-pass swap-chain resolve. Regular
  point geometry and picking also remain at exact model depth.
- Node emphasis is resolved only in this glyph pass, where a matching
  `nodePickId` changes the circle's color/emissive. This keeps node selection
  local and avoids surface z-fighting.
- Default node glyphs are translucent black. The pipeline uses MSAA
  alpha-to-coverage without color blending: uncovered samples preserve the
  surface below, while overlapping glyphs reuse the same coverage mask instead
  of accumulating toward black.

## Demo

- The demo's workbench uses `viewport.pick(x, y, granularity)` for interaction;
  plain click selects the most specific hit (node), Shift promotes to the
  element, Alt to the instance, Ctrl to the part. Hover/selection datasets are
  prefixed by granularity (`n:instance:node`, `f:instance:element:faceKey`,
  `e:instance:element`, `i:instance`, `p:part`). See
  [[rendering/fe-inspection-workbench|FE inspection workbench]].

[architecture/demo-library-boundary|Demo / library boundary]: ../architecture/demo-library-boundary.md
[rendering/element-interaction|element-interaction]: element-interaction.md
[rendering/element-interaction|Element-level interaction]: element-interaction.md
[rendering/fe-inspection-workbench|FE inspection workbench]: fe-inspection-workbench.md
[rendering/interactive-state|Interactive state]: interactive-state.md
[rendering/pick-format|Pick texture format]: pick-format.md
