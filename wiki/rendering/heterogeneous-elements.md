# Heterogeneous element parts

`elementPart` is the recommended bridge from one mixed
`ElementModel` to reusable render parts:

```ts
const part = elementPart(10, model, {
  faceSubset,
});
```

The builder scans the source element list once, validates every element id,
and emits only the primitive groups that are present. Linear and quadratic
triangle/volume elements share one triangle part. Quadratic shapes are rendered
as straight linear facets through their authored mid-edge nodes. Authored line and point
elements become explicit line-list and logical-point leaves because WebGPU
cannot combine incompatible primitive topologies in one draw. The caller
registers the returned semantic part in one scene; it never filters or rebuilds
the source model by family.

Each returned `Part` owns homogeneous primitive leaves for the WebGPU draw
topologies. Its `primitiveRanges` retain one semantic element identity across
those leaves, so one placement carries the complete model without duplicated
part identities.

Each generated descriptor preserves the source `ElementId` and `ElementShape`
in the part-level element table. Every `primitiveRanges` entry qualifies its
`primitiveStart`/`primitiveCount` with `triangles`, `lines`, or `points`. These
ranges drive element
pick ids, body ids, result colors, visibility/highlight state, node picks, and
nodal deformation. Triangle faces retain one deterministic face table and are
compatible with validated `{ elementId, faceIndex }` subsets. The same local
node table is retained by every output group, so placements still reuse the
uploaded buffers through ordinary scene instancing.

Interchange data can be converted once with
`createElementModelFromFemModel`. It preserves element ids and shape blocks,
and requires the `FemModel` node ids to already be dense and ordered because
`ElementModel` indexes nodes directly. Invalid interchange data raises an
`IoError` carrying the validation issues instead of silently dropping a block.

Tri6, Quad8, Tet10, Wedge6, Pyramid5, Hex20, and Line3 are accepted and linearly tessellated; unsupported
families are rejected by `elementPart` with a descriptive validation error.
The builder does not interpolate curved
quadratic geometry or combine incompatible primitives into one draw.

Related: [[rendering/element-rendering|Element rendering]],
[[rendering/element-interaction|Element-level interaction]],
[[rendering/face-subsets|Face subsets]], [[data/io-import-export|IO import/export]],
and [[architecture/core-api|Core API review]].

[architecture/core-api|Core API review]: ../architecture/core-api.md
[data/io-import-export|IO import/export]: ../data/io-import-export.md
[rendering/element-interaction|Element-level interaction]: element-interaction.md
[rendering/element-rendering|Element rendering]: element-rendering.md
[rendering/face-subsets|Face subsets]: face-subsets.md
