# Element blocks and part bodies

The authoritative `ElementModel` authoring contract—including block and body
membership, validation, and editing—lives in
[[data/elements-topology|Element topology]]. This note records only the
scene/geometry ownership consequences of that contract.

`elementPart` derives filtered block descriptors for each triangle, line, and
point group. Block-defined bodies are flattened to resolved element ids in the
derived geometry so the existing renderer and picking path can keep compact
body records. Derived descriptors never become a second authoring owner.

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

`createPart` validates derived body/block metadata before a part enters the
authoritative scene. `ElementTessellation.bodyId` and
`FaceTessellation.bodyId` are derived, validated render/pick metadata retained
for fast local lookup. The `bodyIdForElement` helper resolves the same
relationship for geometry without descriptor metadata. Placements continue to
reference the same reusable part and do not acquire body-local geometry.

Body visibility and styling build on the derived metadata in
[[rendering/interactive-state|Interactive state]]. Face subsets and polygon
authoring remain geometry-owned inputs and do not introduce semantic blocks.

[data/elements-topology|Element topology]: ../data/elements-topology.md
[rendering/interactive-state|Interactive state]: ../rendering/interactive-state.md
