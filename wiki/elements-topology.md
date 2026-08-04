# Element topology

The `src/elements/` subsystem is the typed finite-element foundation for future
polygon extraction, renderer support, and element-level picking. It is pure
CPU-side data with **no dependency on the renderer or WebGPU**.

## Model

- `Element` — `{ id: ElementId, shape: ElementShape, nodeIds: readonly NodeId[] }`.
  `ElementId`/`NodeId` are stable non-negative integers. `nodeIds` follow the
  canonical ordering for `shape` (see `topologyFor`).
- `ElementShape` — a `family` plus an explicit `order` (0 point, 1 linear,
  2 quadratic), so element kind is never inferred from raw triangles.
- `createElement(id, shape, nodeIds)` — the validated constructor. It copies
  `nodeIds` so each element owns its connectivity.

## Shapes

| Shape         | Family  | Order | Nodes | Corners | Mid-edge nodes |
| ------------- | ------- | ----- | ----- | ------- | -------------- |
| `POINT_SHAPE` | `point` | 0     | 1     | 1       | 0              |
| `LINE_SHAPE`  | `line`  | 1     | 2     | 2       | 0              |
| `LINE3_SHAPE` | `line`  | 2     | 3     | 2       | 1              |
| `TET4_SHAPE`  | `tet`   | 1     | 4     | 4       | 0              |
| `TET10_SHAPE` | `tet`   | 2     | 10    | 4       | 6              |
| `HEX8_SHAPE`  | `hex`   | 1     | 8     | 8       | 0              |
| `HEX20_SHAPE` | `hex`   | 2     | 20    | 8       | 12             |

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

## Validation

`createElement` throws on:

- unsupported shapes (`topologyFor` — including unsupported orders);
- connectivity length that does not match the shape's node count;
- duplicate node references;
- negative or non-integer element/node ids.

## Extensibility

New families are added by extending the `ElementFamily` union and registering a
topology in `src/elements/shapes.ts`. Nothing here couples topology to WebGPU.

## Future work

- Polygon extraction: map each element's `nodeIds` (via `corners`/`edges`) to
  triangles/lines for the renderer.
- Renderer support and element-level picking: assign stable pick targets to
  elements instead of only parts/instances.
