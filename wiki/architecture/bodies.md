# Part bodies

The authoritative `ElementModel` body contract—including membership,
validation, and editing—lives in [[data/elements-topology|Element topology]].
This note records the scene/geometry ownership consequences.

A body is an optional stable semantic group whose members are authored elements.
`createPartFromElementModel` derives filtered body descriptors for each triangle, line, and
point geometry group. Derived descriptors never become a second authoring owner.

```ts
const geometry: Geometry = {
  positions,
  indices,
};
const part = createPart(1, {
  geometries: [geometry],
  elements: [
    {
      id: 10,
      primitiveRanges: [{ primitive: "triangles", primitiveStart: 0, primitiveCount: 2 }],
      bodyId: 3,
    },
  ],
  bodies: [{ id: 3, name: "Housing", elementIds: [10] }],
});
```

`createPart` validates derived body metadata before a part enters the
authoritative scene. `ElementTessellation.bodyId` and
`FaceTessellation.bodyId` are derived, validated render/pick metadata retained
for fast local lookup. The `bodyIdForElement` helper resolves the same
relationship for geometry without descriptor metadata. Placements continue to
reference the same reusable part and do not acquire body-local geometry.

Omitting bodies is a real zero-cost path. A bodyless model derives no
model-scaled membership map, body interaction storage, GPU ownership field,
draw, shader read, or per-frame body work. A fixed empty sentinel used to keep a
shared binding layout valid is acceptable.

Semantic element blocks are absent from the product. They are not a body
storage format, a streamed-surface unit, or a compatibility concept. Bodies own
elements directly; transfer and upload chunks remain private implementation
details rather than semantic identities.

Body visibility and styling build on the derived metadata in
[[rendering/interactive-state|Interactive state]]. Face subsets and polygon
authoring remain geometry-owned inputs and do not introduce semantic groups.
Private transfer or upload chunks may share storage between part revisions, but
they have no public identity and are never selectable, hideable, or styled.

[data/elements-topology|Element topology]: ../data/elements-topology.md
[rendering/interactive-state|Interactive state]: ../rendering/interactive-state.md
