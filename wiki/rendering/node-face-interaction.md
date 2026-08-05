# Node and face picking and selection

Node and face interaction build on element interaction (see
[[rendering/element-interaction|Element-level interaction]]) with the same
renderer-independent identity and delta-driven emphasis guarantees. Nodes and
oriented element faces are the finest-grained pickable units under
[[rendering/interactive-state|Interactive state]].

## Stable identities

- **Nodes**: `NodeId` already indexes `ElementModel.nodes` densely. The
  tessellation records a `nodePickIds` array (one `u32` per mesh vertex,
  `nodeId + 1`, `0` for interpolated quadratic vertices such as the center of a
  quadratic quad) plus `nodePositions` (per `NodeId`, three floats) so picks
  resolve to local/world positions on the CPU.
- **Faces**: `facesOfElement` pairs every `facesOf(element)` result with a
  stable `faceIndex` (canonical order). The tessellation assigns each oriented
  face a part-local `FaceTessellation` (stable `id`, `elementId`,
  `faceIndex`, canonical `key`, node loop, `neighborElementIds`) and writes a
  per-triangle `facePickIds` map (`faceId + 1`, `0` = no face).
- `Geometry` carries `nodePickIds`, `nodePositions`, `facePickIds`, and
  `faces`; `validatePickIds` enforces the per-vertex/per-triangle lengths and
  that face ids are dense. Both GPU and CPU pickers resolve from the same part
  geometry, so ids stay stable across renderers, culling, and compaction.

## Picking

- The GPU pick pass now renders **four** `rgba8unorm` attachments: instance,
  element, face, and node ids (see [[rendering/pick-format|Pick texture format]]).
  `readPickPixel` copies all four into one pooled readback buffer.
- Triangle geometry feeds the per-triangle element/face ids and per-vertex
  node ids; a dedicated `nodePickVertexShader`/`nodePickFragmentShader`
  (triangle pick pipeline) passes each triangle's three corner positions and
  node ids as flat varyings plus the interpolated local position, and the
  fragment reports the node id of the corner nearest the hit. Lines and points
  report element/face/node = 0.
- `resolvePickTarget(context, ids, granularity)` returns the most specific
  level the hit supports (`node` > `face` > `element` > `instance` > `part`).
  Passing a `granularity` promotes/narrows the hit to that level, falling back
  to the deepest available when a deeper level is requested. Node targets carry
  local/world position and geometry-derived adjacency; face targets carry the
  oriented node loop, world-space normal, neighbor elements, and a hit position
  (the face centroid for rasterized picks).
- **CPU fallback**: `pickFromRay` raycasts the triangle tessellation of every
  considered instance (Möller–Trumbore) and returns the same targets, with the
  exact hit position on face targets. `rayFromPixel(camera, x, y)` builds a
  pick ray for a pixel, so a camera + `pickFromRay` replaces the GPU pass.

## Interaction state and emphasis

- `InteractionState` adds `selectedNodeIds`, `highlightedNodeIds`,
  `hoveredNode`, `selectedFaces` (per instance, mapping `FaceKey` to the owning
  `ElementId`), `highlightedFaces`, and `hoveredFace` (see
  `interaction/nodes.ts`, `interaction/faces.ts`, and `interaction/refs.ts`).
- `resolveNodeStyle`/`resolveFaceStyle` apply the same precedence as element
  state (highlight < hover < selection, all above part/instance).
- GPU emphasis reuses the generalized per-part emphasis buffer: a record now
  carries exactly one of `elementPickId`, `facePickId`, or `nodePickId`. The
  color vertex shader matches element records against the per-triangle element
  id, face records against the per-triangle face id, and node records against
  the triangle's three vertex node ids (`triangleHasNode`). Node selection
  therefore glows the incident triangles without geometry rebuilds.
- The bounded per-part emphasis capacity documented in
  [[rendering/element-interaction|element-interaction]] applies to node/face records too
  (tracked in [femgx#68](https://github.com/dirkphilip/femgx/issues/68)).

## Demo

- The demo's workbench ([[rendering/fe-inspection-workbench|FE inspection
      workbench]]) uses the unified CPU `pick()` for both renderers; plain click
      selects the most specific hit (node), Shift promotes to the element, Alt to
      the instance, Ctrl to the part. Hover/selection datasets are prefixed by
      granularity (`n:instance:node`, `f:instance:element:faceKey`,
  `e:instance:element`, `i:instance`, `p:part`). The WebGPU renderer also
      exposes `renderer.pick(x, y, granularity)`, whose renderer-independent CPU
      analogue is `pickFromRay` + `rayFromPixel`.
