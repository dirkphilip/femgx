# Element rendering

How finite elements become drawable geometry. Linear shapes are Core now;
quadratic tessellation is retained code but Deferred by the product contract.
Related: [[data/elements-topology|Element topology]] and
[[architecture/instancing-strategy|Instancing strategy]].

## Pipeline

1. `createElementModel` (`src/elements/model.ts`) validates a CPU-side model:
   dense node ids plus typed elements (`src/elements/element.ts`).
2. `facesOf` / `classifyFaces` (`src/elements/faces.ts`) and `edgesOf` /
   `uniqueEdges` (`src/elements/edges.ts`) express each element's faces and
   edges in the element's own node ids. Face loops use the
   canonical VTK corner order; quadratic mid-edge nodes are aligned with the
   edges they bisect, so geometry is never fabricated.
3. `elementGeometry` (`src/geometry/element-mesh.ts`) tessellates the model into
   a `Geometry` tagged with a `Primitive` (`"triangles" | "lines" | "points"`,
   default `"triangles"`, see `src/geometry/part.ts`). `elementPart` wraps the
   result in a reusable part with computed bounds.
4. The renderer (`src/renderer/`) creates color and pick pipelines per
   primitive, batches instances by part, and draws with the part's primitive
   (see [[rendering/renderer-subrange-updates|Renderer subrange updates]]).

Volume geometry (`solid`/`surface` triangles) carries an
`ElementTessellation` per element — the contiguous triangle range it owns —
so every triangle maps to its element id. The renderer turns these into
per-triangle pick ids and highlight records, making elements selectable at the
element level through GPU picking (see
[[rendering/element-interaction|Element interaction]]). Line and point parts are
instance-pickable only: the point-sprite shader never emits element ids, and
the line pipeline shares the triangle element-map layout.

## Render modes

Each element family supports a subset of modes (`elementRenderModes`):

| Family    | Modes                       |
| --------- | --------------------------- |
| tet / hex | `solid`, `surface`, `edges` |
| line      | `lines`                     |
| point     | `points`                    |

- `solid` and `surface` tessellate only boundary faces: faces whose corner-node
  set is referenced by exactly one element. Shared interior faces are culled at
  the source, so no coincident triangles compete in the depth buffer.
- `edges` deduplicates element edges by their unordered corner pair, so shared
  edges are emitted once.
- Points become screen-space sprite quads (4 vertices per point); the point
  vertex shader expands them to a constant CSS-pixel size
  (`WebGpuRendererOptions.pointSizePixels`, default 8), scaled by
  `devicePixelRatio` into device pixels so apparent size is stable across
  displays. The visible color path renders at 4× MSAA and resolves to the
  canvas, so mesh edges and line lists are antialiased.

The gallery's `edges` mode is edges-only geometry switched in through part
visibility. On top of that, a per-instance `edge` style override (see
[[rendering/element-interaction|Element-level interaction]]) overlays a part's edges as
lines on its solid surface, with an optional depth-test toggle — so a model can
be shown solid with a wireframe overlay instead of edges-only.

The inspection demo presents a single `Solid` display and optional edge
overlay. Solid geometry is a boundary skin, so selection remains a color change
on the selected element/node's existing triangles—never a highlight pass.
Triangle pipelines do not cull back faces by default: 2D FE shells are valid
geometry and must remain inspectable from either side. The edge shader applies
the same transform as the surface shader, and the depth-tested edge pipeline
uses `less-equal`: coplanar edges pass at their exact surface depth while edges
behind nearer geometry remain occluded. Because line and triangle rasterization
can quantize the same geometric depth differently, the edge fragment shader
pulls the final line depth forward by one 24-bit depth-buffer unit. Do not pull
overlay vertices toward the camera in clip space: the larger pre-rasterization
offset can move a genuinely occluded edge in front of a nearby surface.

## Deferred quadratic support

Quadratic elements are **never silently reduced** to linear geometry in the
retained implementation. They are not part of the minimum product and must not
be expanded without a new product decision:

- Tet10 faces are each subdivided into 4 triangles through the three mid-edge
  nodes (one center triangle + three corner triangles).
- Hex20 quads are each subdivided into 8 triangles through the mid-edge nodes
  (a center vertex joined to the 8 quad-edge halves).
- Curved (LINE3) edges are interpolated with quadratic Lagrange through the
  mid-edge node (`quadraticPoint` in `src/geometry/vec-math.ts`), with
  `edgeSegments` control (default 2, clamped to ≥ 2 so the mid-edge node is
  honored). Linear edges always stay a single segment.

This keeps geometry conforming: adjacent quadratic elements share mid-edge
nodes, and the mesh generator only needs the element's own connectivity.

## Tessellation cost

Tessellation happens once at part build time and is amortized over instances;
instanced draws reuse the tessellated part. Costs grow with the quadratic factor
(a Tet10 is 4x its Tet4 triangle count per face) and with `edgeSegments`, but
these are CPU/upload costs only — the draw is still a single instanced call.

## Mode switching is visibility

The demo gallery (`createElementFixture`) exposes one reusable part per
family/mode, so switching modes is pure part visibility:
`SceneRuntime.setPartVisible` flips packed bits and the renderer's
`WebGpuRenderer.updateVisibility` rebuilds only the affected parts' GPU draw
order — no buffers or geometry are rebuilt (see
[[architecture/packed-runtime|Packed scene runtime]]).
