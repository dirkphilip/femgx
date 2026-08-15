# Surface-derived part authoring

This note defines a **Core-now use case** that the current public authoring API
does not yet completely satisfy. The intended host transfers only the
display-relevant geometry of a finite-element part; femgx must not require the
omitted solid topology merely to reconstruct the same surface.

Related: [[requirements/product-scope|Product scope]],
[[rendering/element-rendering|Element rendering]], and
[[rendering/face-subsets|Face subsets]].

## Required part input

One reusable logical part may contain any combination of:

- polygonal facets owned by stable faces and elements;
- authored line elements; and
- authored point elements.

Facets compile to triangles, lines to line segments, and points to logical
points in the existing mixed `Part` normal form. Different WebGPU pipelines do
not create separate authoring parts or identities.

For a solid source model, the transferred geometry is authoritative. A Hex20
element may contribute only one retained eight-node face; femgx does not need
its other faces, complete 20-node connectivity, or `ElementShape` to render
that face. Source shape metadata may remain host-owned. A face omitted from the
payload cannot later be revealed by client-side visibility, so hosts that need
body or material interfaces must include them or replace the scene.

`elementPart(..., { faceSubset })` does not satisfy the memory contract: it
retains complete tessellated geometry and filters only draw indices. This path
must avoid constructing omitted geometry.

## Compact facet connectivity

The host protocol supplies one count-prefixed integer stream. Each record is a
signed node count followed by `abs(count)` indices into the shared node-position
array:

```text
signedCount, nodeIndex0, nodeIndex1, ..., nodeIndex(abs(count) - 1)
```

- A positive count denotes a general linear polygon.
- A negative count denotes a quadratic face.
- The initially required quadratic records are `-6` for Tri6 and `-8` for
  Quad8/Hex20 faces; other negative counts fail at the input boundary.

```text
4,  0, 1, 2, 3,
-8, 4, 8, 5, 9, 6, 10, 7, 11
```

Quadratic node ordering must be explicit and validated, never inferred from
coordinates. An adapter may normalize the established host ordering into the
existing quadratic tessellator. The sign is decoded once at the authoring
boundary rather than leaking into geometry or renderer code.

Each facet record also carries an owning `ElementId`, a stable element-local
`faceIndex` or equivalent source identity, and optional neighbor identity. Line
and point records likewise carry their owning elements. The final public
TypeScript shape is intentionally left to the implementation, but it must
accept compact typed-array data without requiring one temporary JavaScript
object per face.

## Node and primitive identity

Connectivity values are dense, zero-based part-local `NodeId`s that index the
part's node-position array, consistent with `ElementModel`. The host retains a
separate aligned map to sparse, large, or nonnumeric source node identities.
Picking, nodal results, and deformation use the part-local id; the host maps it
back when needed. Repeated records share a node by reusing its local id, while
coincident coordinates with different ids remain distinct nodes.

The compiled part has at most one triangle, line, and point geometry group. An
element may own ranges in more than one group; facet triangles additionally map
to their oriented face. Construction validates and sizes the typed output
buffers directly so the input connectivity can be released afterward.

Authored line elements are not inferred surface edges, point elements are not
node annotations, and tessellation diagonals are never authored edges. Exact
edge interaction requires explicit edge identity and incidence or source
topology from which femgx can derive them.

Only retained geometry participates in rendering, results, and interaction.
Elements with no retained primitive have no renderer identity; nodal results
and deformation require only retained nodes. Geometry is uploaded once per
part and reused by every assembly placement.

## Replacement and negative space

The mixed explicit-topology boundary replaces public `polygonPart()`,
`polygonGeometry()`, `PolygonGeometryInput`, and `PolygonFaceInput` after it
subsumes their useful contracts: deterministic convex and concave polygon
tessellation, validation, face/element/body ownership, node picking and
deformation, and empty no-draw input. Migrate those regression cases and the
generic demo fixture, delete the superseded exports and documentation, and
retain only shared triangulation and validation machinery. Do not keep a
compatibility alias or second polygon-only public path.

The host may transfer the compact payload over its own protocol, but femgx
receives one complete in-memory part payload. This does not restore the removed
library-owned streaming subsystem: progressive chunks, spatial partitioning,
levels of detail, residency, upload budgets, worker parsing, and incremental GPU upload
remain out of scope. Shape inference, omitted-volume reconstruction, curved
interpolation, and derived engineering quantities also remain out of scope.

## Decision gate

1. **Value:** avoid transferring and retaining solid data the host has already
   reduced, without splitting one semantic part by render primitive.
2. **Minimum:** compile compact facets, lines, and points into one reusable
   `Part` with existing element, face, and node interaction mappings.
3. **Deletion:** replace the polygon-only builders and converge explicit and
   typed topology on the existing `Part` normal form.
4. **Out of scope:** the reconstruction, inference, interpolation, and
   library-owned streaming capabilities listed above.
5. **Public surface:** one mixed explicit-topology authoring boundary is
   necessary; no new renderer abstraction is.

[rendering/face-subsets|Face subsets]: ../rendering/face-subsets.md
[rendering/element-rendering|Element rendering]: ../rendering/element-rendering.md
[requirements/product-scope|Product scope]: product-scope.md
