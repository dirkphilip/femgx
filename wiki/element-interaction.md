# Element-level interaction

Element selection, highlighting, and picking build on the part/instance system
(see [[interactive-state|Interactive state]] and [[pick-format|Pick texture
format]]) without regressing it. Elements are the unit of FE-feature selection
(e.g. a shell or a stiffener), while instances stay the unit of instancing.

## Stable element ids

- `Geometry` optionally declares `ElementTessellation` descriptors: a stable
  `id` plus the contiguous triangle range (`triangleStart`, `triangleCount`)
  that tessellates the element in the part's index buffer
  ([[elements-topology|Element topology]]).
- `validateElements` enforces that, when declared, every triangle belongs to
  exactly one element and ids are unique. Parts without descriptors are not
  element-pickable and every triangle reports "no element".
- The GPU pick map stores `elementId + 1` per triangle (`0` = none), so the
  id `0` collision with "no element" is avoided; `buildElementTrianglePickIds`
  mirrors the CPU descriptor exactly.

## Picking

- The pick pass renders two attachments: the existing instance pick id and a
  per-triangle element pick id (`pickFragmentShader` writes both). Both use the
  `rgba8unorm` packing of [[pick-format|pick-format]].
- `readPickPixel` copies both attachments into one pooled readback buffer and
  decodes both ids; `resolvePickTarget` turns a hit into an `element` target
  only when both ids hit, otherwise falls back to the `instance` target. A
  `PickTarget` therefore distinguishes `part`, `instance`, and `element`.
- The demo encodes hover/selection keys as `instanceId:elementId` for element
  targets and `instanceId` for instance targets.

## Interaction state and precedence

- `InteractionState` adds `selectedElementIds` (per instance), `hoveredElement`,
  and `elementOverrides`.
- `resolveElementStyle` resolves the instance style first, then applies element
  hover, element selection, then an explicit element override. Element state
  beats instance/part state; selection beats hover; explicit overrides win last.
- `emphasizedElementRefs` collects every emphasized occurrence (hovered,
  selected, or overridden) in deterministic order with no duplicates.

## GPU emphasis without material clones

- Each part storage has a fixed-capacity `ElementHighlights` storage buffer
  (records at `ELEMENT_RECORD_STRIDE` bytes, up to `MAX_ELEMENT_HIGHLIGHTS`
  records) that the color vertex shader scans per triangle: a record matching
  the part-local slot and the triangle's element pick id overrides color and
  emissive. Emphasis therefore never clones materials or rebuilds geometry.
- `syncElementHighlights` maps emphasized refs to per-part records
  (`collectElementHighlightUpdates`), dropping refs whose instance is not in the
  layout (e.g. hidden or stale), and `writeElementHighlights` diffs against a
  CPU mirror so only changed byte subranges reach the GPU. Records beyond the
  fixed capacity are dropped (documented rendering limit for very large
  selections).

## Edge display mode

- `DisplayMode` (`solid` | `edge`) selects whether the color pass also draws a
  wireframe edge overlay. Edges are a deduplicated line list per part
  (`buildMeshEdges`), uploaded once like the triangle buffers.
- The overlay pipeline draws with depth writes off on top of the solid pass, so
  hover/selection still show through the solid fill underneath; the edge pass
  itself renders instance-level style only.

## Limits and follow-ups

- Element emphasis is per-part bounded (`MAX_ELEMENT_HIGHLIGHTS`); very large
  multi-element selections render the first records only.
- The edge overlay draws instance-level emphasis, not per-element edges, because
  edges shared between adjacent elements have no unambiguous element owner.
