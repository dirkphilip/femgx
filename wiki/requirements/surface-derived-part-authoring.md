# Surface-derived part authoring

This note defines the **Core-now** `createPartFromExplicitTopology()` authoring contract. The host
transfers only the display-relevant geometry of a finite-element part; femgx
does not require omitted solid topology to reconstruct the same surface.

Related: [[requirements/product-scope|Product scope]],
[[rendering/element-rendering|Element rendering]], and
[[rendering/face-subsets|Face subsets]].

## Required part input

One reusable logical part may contain any combination of:

- polygonal facets owned by stable elements and, when supplied, stable faces;
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

This is the client/server transfer-minimizing contract: a server may retain the
omitted volume while sending one complete display payload to the client. femgx
does not know whether omitted topology exists, and it must not infer, request,
cache, render, or expose identities that were not supplied. Hiding a retained
facet or element may therefore leave a hole rather than reveal an interior
face. A later server response is a host-owned replacement payload, not an
incremental femgx geometry stream.

`createPartFromElementModel(..., { faceSubset })` does not satisfy the memory contract: it
retains complete tessellated geometry and filters only draw indices. This path
must avoid constructing omitted geometry.

Likewise, a presentation choice such as disabling edge and node overlays says
nothing about topology residency. The host chooses `createPartFromExplicitTopology()` when the
client must not own the interior; a renderer display toggle cannot convert a
fully authored part into that data contract.

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

`ExplicitTopologyInput.facets` always carries a parallel `elementIds` array
with one entry per decoded facet. Supplying an aligned `faceIndices` array makes
the stream face-owned; its optional `neighbors` stream then uses aligned `0`
records for boundaries and `1, neighborElementId` records for an interface.
Omitting `faceIndices` makes the stream element/node-only. It retains no face,
neighbor, face-subset, or facet-derived authored-edge semantics, and supplying
`neighbors` in that form is rejected at the boundary. `lines.connectivity`
accepts `2, a, b` and `3, a, mid, b`; points use a flat `nodeIds` array. Lines
and points have aligned `elementIds`. Every field accepts typed arrays without
requiring one JavaScript object per face.

```ts
const part = createPartFromExplicitTopology(10, {
  positions,
  facets: { connectivity: facets, elementIds }, // no authored face identity
  lines: { connectivity: lines, elementIds: lineElementIds },
  points: { nodeIds: pointNodeIds, elementIds: pointElementIds },
});
```

Add `faceIndices` (and, when present, `neighbors`) only when the host needs
authored face picking, face visibility, adjacency, or facet-derived exact edge
identity. The face-owned and element/node-only forms share the same one `Part`
and assembly-placement lifecycle.

## Node and primitive identity

Connectivity values are dense, zero-based part-local `NodeId`s that index the
part's node-position array, consistent with `ElementModel`. The host retains a
separate aligned map to sparse, large, or nonnumeric source node identities.
Picking, nodal results, and deformation use the part-local id; the host maps it
back when needed. Repeated records share a node by reusing its local id, while
coincident coordinates with different ids remain distinct nodes.

The compiled part has at most one triangle, line, and point geometry group. An
element may own ranges in more than one group; face-owned facet triangles also
map to their oriented face. Construction copies `positions` once into one
part-owned dense Float32 node table. Every primitive group's indices address
that table directly, and one shared private `nodeId + 1` map preserves node
picking and deformation without copied per-group coordinate or identity arrays.
Bounds use only node rows referenced by retained connectivity, so unused source
rows do not enlarge the part. Renderer-specific triangle corners, line quads,
and point sprites may still be derived per draw path.

Authored line elements are not inferred surface edges, point elements are not
node annotations, and tessellation diagonals are never authored edges. Exact
edge interaction requires explicit edge identity and incidence or source
topology from which femgx can derive them.

Only retained geometry participates in rendering, results, and interaction.
Elements with no retained primitive have no renderer identity; nodal results
and deformation require only retained nodes. An element/node-only facet stream
renders and picks elements and nodes, but face picks resolve to no target and
node face-derived adjacency is empty. Geometry is uploaded once per part and
reused by every assembly placement.

## Replacement and negative space

`createPartFromExplicitTopology()` replaced the former polygon-only builders and subsumes their
useful contracts: deterministic convex and concave tessellation, validation,
face/element/body ownership, node picking and deformation, and empty no-draw
input. The implementation retains shared triangulation and edge-incidence
machinery without a compatibility alias or second polygon-only public path.

The host may transfer the compact payload over its own protocol, but femgx
receives one complete in-memory part payload. This does not restore the removed
library-owned streaming subsystem: progressive chunks, spatial partitioning,
levels of detail, residency, upload budgets, worker parsing, and incremental
GPU upload remain out of scope. Shape inference, omitted-volume reconstruction, curved
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
