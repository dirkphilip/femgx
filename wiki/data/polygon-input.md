# Polygon input

`polygonGeometry` and `polygonPart` are the geometry-owned authoring path for
simple polygon faces that are not already represented by a typed finite-element
shape. The input contains one shared xyz position array and ordered face loops:

```ts
const part = polygonPart(10, {
  positions: [0, 0, 0, 2, 0, 0, 2, 2, 0, 1, 1, 0, 0, 2, 0],
  faces: [
    {
      nodeIds: [0, 1, 2, 3, 4],
      elementId: 7,
      key: "source-face",
    },
  ],
});
```

Each input face becomes one oriented `(elementId, faceIndex)` identity. Its
canonical `key`, neighbor element ids, and exact triangle
`primitiveStart`/`primitiveCount` range are retained in the resulting
`FaceTessellation`; face-array order is not identity. Triangle ranges are
grouped by element so element picking and results can use the existing
`ElementTessellation` contract. Node pick ids and source node positions are
also preserved for node picking and nodal deformation.

Polygon triangles use the same internal shared-index assembler as typed finite
elements. Repeated authored node ids reuse one output vertex, while coincident
coordinates with different node ids remain separate. Ear-clipping order is
preserved in the index buffer, so element and face primitive ranges stay
contiguous and deterministic.

The builder validates finite positions, node references, duplicate or too-short
loops, planarity, zero area, self-intersection, and face metadata before any
geometry is returned. A deterministic ear-clipping pass preserves the input
winding. Empty positions and faces are valid and produce a finite, no-draw
part. Holes, boolean polygon operations, and a second GPU primitive path are
outside this API; callers should compose separate faces instead.

Related: [[data/elements-topology|Element topology]],
[[rendering/element-rendering|Element rendering]], and
[[architecture/core-api|Core API review]].

[architecture/core-api|Core API review]: ../architecture/core-api.md
[data/elements-topology|Element topology]: elements-topology.md
[rendering/element-rendering|Element rendering]: ../rendering/element-rendering.md
