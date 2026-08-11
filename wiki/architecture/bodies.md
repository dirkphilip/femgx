# Part bodies

Bodies are logical groups owned by reusable part geometry. A body has a stable
numeric `id`, an optional display `name`, and an ascending list of element ids;
it does not copy positions, indices, or faces. An element may belong to at most
one body, and ungrouped elements remain valid.

```ts
const geometry: Geometry = {
  positions,
  indices,
  elements: [{ id: 10, primitiveStart: 0, primitiveCount: 2, bodyId: 3 }],
  bodies: [{ id: 3, name: "Housing", elementIds: [10] }],
};
```

`createPart` validates body metadata before a part enters the authoritative
scene. `Body.elementIds` is the single authoring source of membership;
`ElementTessellation.bodyId` and `FaceTessellation.bodyId` are derived,
validated render/pick metadata retained for fast local lookup. The
`bodyIdForElement` helper resolves the same relationship for geometry without
descriptor metadata. Placements continue to reference the same reusable part
and do not acquire body-local geometry.

Body visibility and styling build on this metadata in
[[rendering/interactive-state|Interactive state]]. Face subsets and polygon
authoring preserve the same body/element ownership rather than introducing a
second grouping model.

[rendering/interactive-state|Interactive state]: ../rendering/interactive-state.md
