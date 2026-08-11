# Element rendering

How finite elements become drawable geometry. Point, Line, Line3, Triangle, Quad,
Tet4, Tet10, Hex8, and Hex20 are Core now, including quadratic tessellation.
Related: [[data/elements-topology|Element topology]] and
[[architecture/instancing-strategy|Instancing strategy]].

## Pipeline

1. `createElementModel` (`src/elements/model.ts`) validates a CPU-side model:
   dense node ids plus typed elements (`src/elements/element.ts`). Interchange
   models use `createElementModelFromFemModel` for one validated conversion.
2. `facesOf` / `classifyFaces` (`src/elements/faces.ts`) and `edgesOf` /
   `uniqueEdges` (`src/elements/edges.ts`) express each element's faces and
   edges in the element's own node ids. Face loops use the
   canonical VTK corner order; quadratic mid-edge nodes are aligned with the
   edges they bisect, so geometry is never fabricated.
3. `heterogeneousElementParts` (`src/geometry/heterogeneous-element-mesh.ts`)
   scans the model once and emits the compatible primitive groups needed by
   WebGPU: at most one triangle, line, and point part. Triangle, quad, Tet4,
   Tet10, Hex8, and Hex20 elements share the triangle group; line and point
   elements use their own topology groups. Each group is a reusable part with
   computed bounds. Triangle callers can pass a validated `faceSubset` of
   `{ elementId, faceIndex }` identities; the renderer keeps the full reusable
   vertex mesh and draws selected faces through a compact index order (see
   [[rendering/face-subsets|Face subsets]]).
4. The renderer (`src/renderer/`) creates color and pick pipelines per
   primitive, batches instances by part, and draws with the part's primitive
   (see [[rendering/renderer-subrange-updates|Renderer subrange updates]]).

Visible triangle surfaces use one internal flat-lighting fragment path. It
derives a geometric normal from the displayed world position, applies a
camera-following key direction with strong ambient fill, and uses an absolute
two-sided response so shell geometry remains readable from either side. Line,
point, edge, node-overlay, and picking paths remain unlit; lighting does not
alter alpha or the existing interaction emissive.

Triangle geometry carries an
`ElementTessellation` per element — the contiguous `primitiveStart`/
`primitiveCount` range it owns — so every triangle maps to its element id. Mixed
models use the same metadata contract for line and point variants (see
[[rendering/heterogeneous-elements|Heterogeneous element parts]]). The renderer
turns all ranges into per-primitive pick ids and
highlight records, making elements and nodes selectable through GPU picking
(see [[rendering/element-interaction|Element interaction]]).

## Primitive groups and overlays

- Triangle geometry tessellates only boundary faces: faces whose corner-node
  set is referenced by exactly one element. Shared interior faces are culled at
  the source, so no coincident triangles compete in the depth buffer.
- Points are authored as one center and one index per logical point. GPU upload
  expands each center into a screen-space sprite quad (4 vertices per point);
  the point vertex shader sizes it to a constant CSS-pixel diameter
  (`WebGpuRendererOptions.pointSizePixels`, default 8), scaled by
  `devicePixelRatio` into device pixels so apparent size is stable across
  displays. The visible color path renders at 4× MSAA and resolves to the
  canvas, so mesh edges and line lists are antialiased.
- Mixed builds keep triangle, line, and point topologies in explicit reusable
  parts. They share source node and element identities without forcing
  incompatible primitives into one draw.

A per-instance `edge` style override (see
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

## Quadratic tessellation

Quadratic element connectivity is accepted and deterministically linearized
through its authored mid-edge nodes:

- Tet10 faces are each subdivided into 4 triangles through the three mid-edge
  nodes (one center triangle + three corner triangles).
- Hex20 quads are each subdivided into 8 triangles through the mid-edge nodes
  (a center vertex joined to the 8 quad-edge halves).
- LINE3 edges are emitted as two straight segments through the mid-edge node.
  No quadratic curve interpolation or adaptive subdivision is part of the
  rendering contract.

This keeps geometry conforming: adjacent quadratic elements share mid-edge
nodes, and the mesh generator only needs the element's own connectivity.

## Tessellation cost

Tessellation happens once at part build time and is amortized over instances;
instanced draws reuse the tessellated part. Costs grow with the fixed
linearization factor (a Tet10 is 4x its Tet4 triangle count per face), but these
are CPU/upload costs only — the draw is still a single instanced call.

[architecture/instancing-strategy|Instancing strategy]: ../architecture/instancing-strategy.md
[architecture/packed-runtime|Packed scene runtime]: ../architecture/packed-runtime.md
[data/elements-topology|Element topology]: ../data/elements-topology.md
[rendering/element-interaction|Element interaction]: element-interaction.md
[rendering/element-interaction|Element-level interaction]: element-interaction.md
[rendering/face-subsets|Face subsets]: face-subsets.md
[rendering/heterogeneous-elements|Heterogeneous element parts]: heterogeneous-elements.md
[rendering/renderer-subrange-updates|Renderer subrange updates]: renderer-subrange-updates.md
