# Element blocks and part bodies

`ElementModel` is the single authoring owner of finite elements, optional
semantic `ElementBlock`s, and `Body`s. A block is a stable, non-overlapping
group of element ids. A body either lists direct `elementIds` or aggregates
`blockIds`; it never uses both forms. Blocks and bodies have strictly ascending
one-based ids, and empty groups are rejected. Unassigned elements and blocks
remain valid.

```ts
const model = createElementModel(nodes, elements, {
  blocks: [
    { id: 10, name: "shell property", elementIds: [1, 2] },
    { id: 11, name: "solid property", elementIds: [3] },
  ],
  bodies: [{ id: 20, name: "housing", blockIds: [10, 11] }],
});
```

The blockless path omits `blocks` entirely. It does not synthesize one block per
body or allocate block indexes. Direct body membership remains the common,
zero-block representation.

`heterogeneousElementParts` derives filtered block descriptors for every
triangle, line, and point group. Block-defined bodies are flattened to their
resolved element ids in derived geometry so the existing renderer/picking path
can keep its compact body records. Derived descriptors never become a second
authoring owner.

```ts
const geometry: Geometry = {
  positions,
  indices,
  elements: [{ id: 10, primitiveStart: 0, primitiveCount: 2, bodyId: 3 }],
  bodies: [{ id: 3, name: "Housing", elementIds: [10] }],
};
```

`createElementModel` validates identity, membership, ordering, references, and
cross-body invariants at the owning boundary. `createPart` then validates the
derived body/block metadata before a part enters the authoritative scene.
`ElementTessellation.bodyId` and `FaceTessellation.bodyId` are derived,
validated render/pick metadata retained for fast local lookup. The
`bodyIdForElement` helper resolves the same relationship for geometry without
descriptor metadata. Placements continue to reference the same reusable part
and do not acquire body-local geometry.

Body visibility and styling build on the derived metadata in
[[rendering/interactive-state|Interactive state]]. Face subsets and polygon
authoring remain geometry-owned inputs and do not introduce semantic blocks.

[rendering/interactive-state|Interactive state]: ../rendering/interactive-state.md
