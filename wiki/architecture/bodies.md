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

`validateBodies` checks duplicate ids, deterministic ordering, unknown element
references, duplicate membership, and consistency between the body list and
each `ElementTessellation.bodyId`. `SceneBuilder.addPart` runs this validation
before the part enters the authoritative scene. `bodyIdForElement` is the
small lookup used by picking and interaction layers; placements continue to
reference the same reusable part and do not acquire body-local geometry.

Body visibility and styling build on this metadata in
[[rendering/interactive-state|Interactive state]]. Face subsets and polygon
authoring preserve the same body/element ownership rather than introducing a
second grouping model.

[rendering/interactive-state|Interactive state]: ../rendering/interactive-state.md
