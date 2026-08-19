# Element rendering

How finite elements become drawable geometry. Point, Line, Line3, Triangle, Tri6,
Quad, Quad8, Tet4, Tet10, Wedge6, Pyramid5, Hex8, and Hex20 are Core now, including quadratic tessellation.
Related: [[data/elements-topology|Element topology]].

## Pipeline

1. `createElementModel` (`src/elements/model.ts`) validates a CPU-side model:
   dense node ids plus typed elements (`src/elements/element.ts`). Interchange
   models use `createElementModelFromFemModel` for one validated conversion.
2. `facesOf` / `classifyFaces` (`src/elements/faces.ts`) and `edgesOf` /
   `uniqueEdges` (`src/elements/edges.ts`) express each element's faces and
   edges in the element's own node ids. Face loops use the
   canonical corner order; quadratic mid-edge nodes are aligned with the
   edges they bisect, so geometry is never fabricated.
3. `elementPart` (`src/geometry/element-part.ts`)
   scans the model once and emits the compatible primitive groups needed by
   WebGPU: at most one triangle, line, and point part. Triangle, Tri6, Quad,
   Quad8, Tet4, Tet10, Wedge6, Pyramid5, Hex8, and Hex20 elements share the triangle group; line and point
   elements use their own topology groups. Each group is a reusable part with
   computed bounds. Triangle callers can pass a validated `faceSubset` of
   `{ elementId, faceIndex }` identities; the renderer keeps the full reusable
   vertex mesh and draws selected faces through a compact index order (see
   [[rendering/face-subsets|Face subsets]]).
4. The renderer (`src/renderer/`) creates color and pick pipelines per
   primitive, batches instances by part, and draws with the part's primitive
   (see [[rendering/renderer-subrange-updates|Renderer subrange updates]]).

Typed finite-element faces and authored polygon faces converge on one internal
triangle assembler. It keys each output vertex by explicit source identity
(authored `NodeId` for typed and surface-derived inputs, or an explicit generated-vertex
identity for node-less geometry), preserves first-seen triangle order, and emits
one compact indexed surface. Coincident positions with different source
identities remain distinct; coordinates are never welded. The assembler copies
scalar coordinates and node mappings into the part-owned typed arrays before
the source tessellation data is released. Line and point builders remain
separate because their primitive and expansion contracts differ.

Indexed line and triangle surfaces are expanded once at GPU upload into
renderer-owned corner vertices. A packed primitive-id range maps every draw
corner back to its logical element/face record, so shared or non-monotonic
indices never make `vertex_index / verticesPerPrimitive` invent the wrong
identity. Face subsets use the same mapping while retaining the full part
metadata. The expansion is per reusable part, not per placement; the edge pass
uses its own endpoint-aligned node-id buffer for deformation.

Visible triangle surfaces use one internal flat-lighting fragment path. It
derives a geometric normal from the displayed world position, applies a
camera-following key direction fixed to the upper-left of the camera frame with
strong ambient fill, and orients the normal toward the viewer before applying a
one-sided key response so shell geometry remains readable from either side
without mirroring the key light through the surface. Line, point, edge,
node-overlay, and picking paths remain unlit; lighting does not alter alpha or
the existing interaction emissive.

Parts carry an `ElementTessellation` table, whose `primitiveRanges` qualify
each owned range by primitive group, so every triangle maps to its element id.
Mixed models use the same metadata contract for line and point variants. The
renderer turns all ranges into per-primitive pick ids and
highlight records, making elements and nodes selectable through GPU picking
(see [[rendering/element-interaction|Element interaction]]).

## Flat-lighting numerical contract

The opaque and translucent triangle passes use the same displayed-geometry
`surfaceLighting` helper. It combines viewer-oriented derivative-normal diffuse
lighting with a small neutral camera-relative specular lobe, then adds the
existing interaction emissive. Lines, points, edges, node annotations, and
picking remain unlit. The view direction is uploaded in the shared camera
uniform, and the helper returns ambient-only color for invalid or degenerate
derivatives so deformation and strong zoom remain finite.
It first divides each screen-space world-position derivative by its own largest
absolute component, then forms and normalizes their cross product. This makes
the geometric normal invariant when perspective zoom or pan changes derivative
magnitude. The only remaining magnitude check is on the normalized cross
product, so nearly parallel or non-finite derivatives return the ambient-only
response instead of producing NaN pixels; there is no scene-scale derivative
cutoff. Surface visibility remains two-sided and lighting remains
camera-following, so zoom, pan, and projection changes do not alter a face's
orientation response.

## Primitive groups and overlays

Authored opaque primitives use one deterministic depth-tie precedence inside
the existing color and pick passes: triangle surfaces establish depth first,
authored lines resolve exact ties second, and authored points resolve exact ties
last. The line and point pipelines use `less-equal` for this purpose; a
genuinely nearer or farther fragment still follows ordinary depth testing.
This ordering is independent of part ids and scene insertion order. The
renderer-owned edge and node overlays remain separate post-composite stages.

- Triangle geometry tessellates the exterior boundary plus both oriented copies
  of a face shared by two differently named bodies. Same-body interior faces
  remain culled. The packed face record carries the owner and neighboring body
  ids, so only the owner-visible side is exposed when the neighbor is hidden;
  all-visible rendering remains the ordinary exterior-only skin.
- Points are authored as one center and one index per logical point. GPU upload
  expands each center into a screen-space sprite quad (4 vertices per point)
  using the complete `[0,1,2, 0,2,3]` triangle split; the point vertex shader
  sizes it to a constant CSS-pixel diameter
  (`ViewportOptions.pointSizePixels`, default 8), scaled by
  `devicePixelRatio` into device pixels so apparent size is stable across
  displays. Node annotations use their independent
  `ViewportOptions.nodeSizePixels` diameter (default 6); both values are
  validated in the inclusive `[1,64]` CSS-pixel range. Point picking keeps a
  minimum 8 CSS-pixel diameter regardless of the visible point size. The
  visible color path renders at 4× MSAA and resolves to the canvas, so mesh
  edges and line lists are antialiased.
- Mixed builds keep triangle, line, and point topologies in explicit reusable
  parts. They share source node and element identities without forcing
  incompatible primitives into one draw.

A per-instance `edge` style override (see
[[rendering/element-interaction|Element-level interaction]]) overlays a part's edges as
lines on its solid surface. Hosts may choose the public
`ViewportPresentation.setEdgeDepthTest` policy, so a model can be shown solid with a
wireframe overlay instead of edges-only.

The inspection demo presents a single `Solid` display and optional edge
overlay. Solid geometry is a dynamic body-aware boundary skin, so selection
remains a color change on the selected element/node's existing triangles—never
a highlight pass. Exposed interfaces reuse the same owner/neighbor predicate
for filled surfaces, GPU picking, deformation, edges, and node annotations.
Triangle pipelines do not cull back faces by default: 2D FE shells are valid
geometry and must remain inspectable from either side. Ordinary opaque surfaces
retain fixed-function raster depth in both camera projections. The resolved
presentation pass draws one-device-pixel native edges at their model depth with
`less-equal`; it does not alter the owning surface depth or pull overlay vertices
toward the camera. Exact edge picking keeps its separate widened geometry.

This depth contract also reduces steady-state work for ordinary surfaces. The
surface fragment shader no longer exports depth or evaluates screen-space depth
derivatives, vector length, and finite-value guards, and the instance record no
longer carries a depth-offset flag. The backend can therefore use its normal
fixed-function depth path. The change adds no draw, pass, attachment, buffer,
readback, or instance-stride cost. Dense selection creates one additional
pipeline state at device setup, reusing the existing shader module, and selects
that state only for the affected draw; its one-unit native depth bias and the
transparent `less-equal` comparison are fixed-function state. Performance-budget
workloads remain the regression authority for these costs.

Edge visibility is keyed by an explicit expanded-endpoint record. Each line
endpoint retains its original source-vertex index while upload builds an
endpoint-aligned node-id buffer for nodal deformation, plus its logical edge
index for the body owner/neighbor predicate. The edge draw must not derive
topology identity from the indexed surface `vertex_index`: that builtin
identifies a referenced surface vertex, not the edge ordinal. Face-subset edge
orders use the same mapping with subset-local logical edge ids.

## Quadratic tessellation

Quadratic element connectivity is accepted and deterministically linearized
through its authored mid-edge nodes:

- Tri6 surfaces and Tet10 faces are each subdivided into 4 triangles through the three mid-edge
  nodes (one center triangle + three corner triangles).
- Quad8 surfaces and Hex20 faces are each subdivided into 6 triangles through the four corners and
  four mid-edge nodes: four corner triangles plus two inner-quad triangles split
  by the deterministic diagonal from the first to the third mid-edge node.
- LINE3 edges are emitted as two straight segments through the mid-edge node.
  No quadratic curve interpolation or adaptive subdivision is part of the
  rendering contract.

This keeps geometry conforming: adjacent quadratic elements share authored
mid-edge nodes, every tessellation vertex follows the existing nodal deformation
and node-picking paths, and the mesh generator only needs the element's own
connectivity.

## Tessellation cost

Tessellation happens once at part build time and is amortized over instances;
instanced draws reuse the tessellated part. Costs grow with the fixed
linearization factor (a Tet10 is 4x its Tet4 triangle count per face), but these
are CPU/upload costs only — the draw is still a single instanced call.

[architecture/packed-runtime|Packed scene runtime]: ../architecture/packed-runtime.md
[data/elements-topology|Element topology]: ../data/elements-topology.md
[rendering/element-interaction|Element interaction]: element-interaction.md
[rendering/element-interaction|Element-level interaction]: element-interaction.md
[rendering/face-subsets|Face subsets]: face-subsets.md
[rendering/renderer-subrange-updates|Renderer subrange updates]: renderer-subrange-updates.md
