# Heterogeneous element parts

`heterogeneousElementParts` is the recommended bridge from one mixed
`ElementModel` to reusable render parts:

```ts
const parts = heterogeneousElementParts({ triangle: 10, line: 11, point: 12 }, model, {
  bodies,
  faceSubset,
});
```

The builder scans the source element list once, validates every element id,
and emits only the primitive groups that are present. Linear triangle, quad,
Tet4, and Hex8 elements share one triangle part. Authored line and point
elements become explicit line-list and point-sprite parts because WebGPU
cannot combine incompatible primitive topologies in one draw. The caller
registers the returned parts in one scene; it never filters or rebuilds the
source model by family.

Each generated descriptor preserves the source `ElementId` and `ElementShape`.
Triangle descriptors use `triangleStart`/`triangleCount`; line and point
descriptors use `primitiveStart`/`primitiveCount`. These ranges drive element
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

Tet10, Hex20, LINE3, and other unsupported shapes are rejected by the
heterogeneous builder with `HeterogeneousElementError` and an element id/shape
when available. The dedicated typed family path supports the quadratic shapes;
this high-level mixed path remains limited to its current compatible groups and
does not combine incompatible primitives into one draw or introduce streaming.

Related: [[rendering/element-rendering|Element rendering]],
[[rendering/element-interaction|Element-level interaction]],
[[rendering/face-subsets|Face subsets]], [[data/io-import-export|IO import/export]],
and [[architecture/core-api|Core API review]].
