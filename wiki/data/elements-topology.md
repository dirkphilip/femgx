# Element topology

The `src/elements/` subsystem is the typed finite-element foundation for polygon
extraction, renderer support, and element-level picking. Point, Line, Line3,
Triangle, Quad, Tet4, Tet10, Hex8, and Hex20 are Core now. The subsystem is pure
CPU-side data with **no dependency on
the renderer or WebGPU**.

## Model

- `Element` — `{ id: ElementId, shape: ElementShape, nodeIds: readonly NodeId[] }`.
  `ElementId`/`NodeId` are stable non-negative integers. `nodeIds` follow the
  canonical ordering for `shape` (see `topologyFor`).
- `ElementShape` — a `family` plus an explicit `order` (0 point, 1 linear,
  2 quadratic), so element kind is never inferred from raw triangles.
- `createElement(id, shape, nodeIds)` — the validated constructor. It copies
  `nodeIds` so each element owns its connectivity.

An `ElementModel` may contain any supported families in one ordered element
list. `heterogeneousElementParts` is the render boundary that groups linear
triangle/quad/Tet4/Hex8 geometry into one triangle part and emits explicit
line/point parts without dropping source ids (see
[[rendering/heterogeneous-elements|Heterogeneous element parts]]). A
serializable `FemModel` can be converted once with
`createElementModelFromFemModel`; its node ids must already be dense because
the render model indexes coordinates directly.

## Shapes

| Shape            | Family     | Order | Nodes | Corners | Mid-edge nodes |
| ---------------- | ---------- | ----- | ----- | ------- | -------------- |
| `POINT_SHAPE`    | `point`    | 0     | 1     | 1       | 0              |
| `LINE_SHAPE`     | `line`     | 1     | 2     | 2       | 0              |
| `LINE3_SHAPE`    | `line`     | 2     | 3     | 2       | 1              |
| `TRIANGLE_SHAPE` | `triangle` | 1     | 3     | 3       | 0              |
| `QUAD_SHAPE`     | `quad`     | 1     | 4     | 4       | 0              |
| `TET4_SHAPE`     | `tet`      | 1     | 4     | 4       | 0              |
| `TET10_SHAPE`    | `tet`      | 2     | 10    | 4       | 6              |
| `HEX8_SHAPE`     | `hex`      | 1     | 8     | 8       | 0              |
| `HEX20_SHAPE`    | `hex`      | 2     | 20    | 8       | 12             |

## Canonical node ordering (VTK convention)

Connectivity lists corners first, then mid-edge nodes in canonical edge order.

- **Tet4/Tet10** corners: `0 1 2 3`. Tet10 mid-edge nodes: `4` on `0-1`, `5` on
  `1-2`, `6` on `2-0`, `7` on `0-3`, `8` on `1-3`, `9` on `2-3`.
- **Hex8/Hex20** corners: `0 1 2 3 4 5 6 7` (bottom `0-1-2-3` counter-clockwise,
  top `4-5-6-7`, vertical `0-4`, `1-5`, `2-6`, `3-7`). Hex20 mid-edge nodes
  `8..19` follow the same edge order: bottom `8-11`, top `12-15`, vertical `16-19`.

`ElementTopology` exposes this structurally via `corners`, `edges` (corner-index
pairs), and `edgeNodes` (aligned with `edges`), which is the foundation for
extracting faces/lines and generating unit geometry.

## Faces and edges

Built on the topology, `src/elements/faces.ts` and `src/elements/edges.ts`
extract deterministic polygon and line output:

- `facesOf(element)` returns the element's faces as oriented polygon loops
  (`ElementFace { key, nodeIds }`). Faces follow the VTK face tables with
  right-hand-rule winding, so a face loop gives an outward normal for a
  right-handed (positive-Jacobian) element; in conforming meshes a shared face
  appears with opposite windings in its two incident elements.
- Quadratic shapes expand each face/edge with their mid-edge nodes, so a Tet10
  face is a six-node loop and a Hex20 face an eight-node loop, interleaving
  `[corner, mid, corner, ...]`.
- A linear triangle or quad exposes its complete surface as one oriented face;
  that face owns all triangles emitted by the surface tessellator.
- Point and line elements have no faces; `edgesOf` exposes a line's single edge
  (including its mid node for `LINE3_SHAPE`), while triangle and quad edges use
  their canonical perimeter order.
- `classifyFaces(elements)` deduplicates coincident faces by a canonical key
  (sorted node ids) and flags boundary faces — those shared by exactly one
  element (`count === 1`); shared faces get `count === 2` and are interior.
- `boundaryFaceRefs(elements)` turns that classification into stable `{ elementId, faceIndex }`
  identities for [[rendering/face-subsets|face subset]] rendering.
- `uniqueEdges(elements)` deduplicates edges across elements, presents each
  edge in ascending corner order with the mid node centered, and sorts the
  result in ascending node order.
- The canonical keys (`FaceKey`/`EdgeKey`) are stable identity strings suitable
  for serialization, and the loops themselves are renderer-uploadable node-id
  polygons. Helpers: `canonicalKey` (`keys.ts`) and bounds-checked `at`
  (`indices.ts`), both internal.

### Hex20 edge order vs VTK

The geometric mid-node assignment — connectivity slot 18 lies on edge `{2,6}`
and slot 19 on edge `{3,7}` — matches VTK's canonical quadratic-hex numbering
exactly (`vtkQuadraticHexahedron` maps mid-edge node 18 to edge `{2,6}` and 19
to `{3,7}`; the golden fixtures in `test/elements/golden.ts` pin this). Only the
order in which the last two vertical edges are _listed_ differs from VTK's
internal `Edges` array index order (`{3,7}`/`{2,6}`), which has no effect on
connectivity import — a file's slots 18/19 map to the same geometric edges in
both conventions — or on set-based face/edge extraction. The earlier claim that
VTK-ordered files swap those two mid nodes (issue #66) was verified against the
VTK source and does not hold; do not "fix" the ordering by swapping slots 18/19.

File-format connectivity that differs from this canonical mid-edge order must
translate at the format boundary. The product currently supports only VTK
legacy, which already matches this order; see
[[data/io-import-export|IO: VTK legacy import/export]].

## Validation

`createElement` throws on:

- unsupported shapes (`topologyFor` — including unsupported orders);
- connectivity length that does not match the shape's node count;
- duplicate node references;
- negative or non-integer element/node ids.

## Golden fixtures

`test/elements/golden.ts` is the single documented reference for the standard
element conventions: canonical node ordering (corners, edges, mid-edge nodes),
the reference unit geometry in meters, and the expected face/edge output.
`test/elements/golden.test.ts` validates `topologyFor`, `facesOf`, and `edgesOf`
against it, verifies bounds and the divergence-theorem volume of the reference
geometry, checks that quadratic mid-edge nodes sit exactly at edge midpoints,
and confirms translated reference geometry keeps its bounds. Failures name the
affected element type.

## Extensibility

New families are added by extending the `ElementFamily` union, declaring the
supported interpolation orders in the `SupportedOrder` type in
`src/elements/shapes.ts`, and registering a topology for each resulting
`<family>:<order>` key. The registry is compiler-exhaustive — the `satisfies`
constraint ties its keys to the derived `SupportedShapeKey` union and pins each
entry's `family`/`order` to the literals encoded in its key — so a missing
topology, an unsupported order, a mis-keyed registration, or an entry whose
`family`/`order` contradict its key fails at compile time instead of at runtime.
`ElementOrder` (`0 | 1 | 2`) narrows the public
`ElementShape.order`/`ElementTopology.order`, and `topologyFor`/`createElement`
keep a runtime safety net for untyped input. Nothing here couples topology to
WebGPU.

## Surface authoring

`TRIANGLE_SHAPE` and `QUAD_SHAPE` are the typed path for linear surface finite
elements. They preserve element ids, node ids, face ownership, deformation,
results, and GPU picking through `heterogeneousElementParts`. Polygon loops
that are not already typed elements belong to the separate geometry-owned
authoring path in [[data/polygon-input|Polygon input]].

[data/io-import-export|IO: VTK legacy import/export]: io-import-export.md
[data/polygon-input|Polygon input]: polygon-input.md
[rendering/face-subsets|face subset]: ../rendering/face-subsets.md
[rendering/heterogeneous-elements|Heterogeneous element parts]: ../rendering/heterogeneous-elements.md
