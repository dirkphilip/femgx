# Topology ownership and GPU residency

This note separates the host-visible model contract from renderer-owned GPU
residency. Related: [[requirements/product-scope|Product scope]],
[[requirements/surface-derived-part-authoring|Surface-derived part authoring]],
and [[rendering/face-subsets|Face subsets]].

## Decision

The public semantic choice is whether the client owns a complete FE model or an
authoritative reduced surface. GPU residency is an implementation strategy and
must not become a public mode unless a host later demonstrates a need for a
deterministic memory/latency policy.

| Host contract                 | Authoring boundary | Available local behavior                                                                            |
| ----------------------------- | ------------------ | --------------------------------------------------------------------------------------------------- |
| Authoritative reduced surface | `surfacePart()`    | Render and interact with supplied identities only. Omitted interiors remain server-owned or absent. |
| Complete client model         | `elementPart()`    | Reveal, render, and interact with retained interior topology after visibility changes.              |

A complete client model may use a compact current skin or complete GPU geometry.
Those strategies must be observationally equivalent: picking, selection,
visibility, results, deformation, bounds, and authored identities cannot depend
on which strategy the renderer chooses.

## Reduced-surface behavior

The `surfacePart()` payload is complete and authoritative from femgx's point of
view. Hiding a retained element may leave a hole. The renderer never infers an
omitted neighbor, creates an interior identity, or contacts a server.

A client/server host may keep the volume on its server and replace the part or
scene after a later request. Stable source-to-client identity mapping and the
request lifecycle remain host responsibilities. This is scene replacement, not
library-owned streaming, caching, or progressive geometry.

## Complete-model residency strategies

The current fully resident strategy uploads complete reusable geometry and uses
an exterior `faceSubset` for ordinary submission. Once any body, block, or
element is hidden, it submits the complete face order and filters faces in the
shader. This is correct, but one visibility change can multiply steady-frame
work by the ratio of retained to exterior faces.

The deferred compact-skin strategy should preserve the same semantics with the
following internal design:

1. Derive an immutable visibility signature for each occurrence from its hidden
   body, block, and element sets.
2. Group occurrences of the same reusable part by signature. Occurrences in a
   group share one draw order and remain GPU-instanced.
3. Compile one compact skin per active `(part definition, visibility signature)`
   pair. The skin contains only currently exposed triangle order, topology
   mapping, and authored surface-edge order; it refers to shared part positions,
   nodal results, and deformation data rather than copying them per occurrence.
4. Use that same skin for color, transparency, visible selection, picking,
   nodes, and depth-tested edge presentation so no pass observes a different
   exposed surface.
5. Publish a new skin atomically after compilation and upload. A frame must use
   either the old complete state or the new complete state, never a partially
   updated mix.

The all-visible exterior skin is pinned and shared. Visibility signatures are
content values rather than occurrence identities, so repeated placements with
the same hidden sets do not duplicate resources.

## Bounded memory and adaptive fallback

Skin residency needs a byte budget, not an entry-count guess. The renderer
tracks shared base geometry, each skin's retained bytes, active references, and
peak upload bytes. Inactive skins may be evicted least-recently-used; skins used
by the current frame cannot be evicted.

Many simultaneously active, distinct visibility signatures can make compact
skins cost more than one complete resource. Before crossing the budget, the
renderer should switch that part to one fully resident resource with shader
visibility filtering. Hysteresis prevents repeated skin/full transitions. This
fallback is bounded by one complete reusable part resource and preserves
correctness without per-instance geometry copies.

Initial implementation and benchmarks should use explicit internal budgets.
Do not add a public capacity, residency enum, or renderer mode until measured
host requirements show that the adaptive policy is insufficient.

## Interaction and edge implications

Only submitted skin faces are visible-surface pick targets. A complete client
model may still perform the existing host-side Through element query over its
authoritative CPU topology; a reduced surface cannot select omitted elements.

Skin derivation also prevents a hidden element from activating every retained
interior edge. It does not solve the separate cost of drawing millions of edges
on a genuinely dense exterior surface. That path needs its own measured design.
A promising prototype is an integrated depth-tested authored-edge mask in the
surface pass, with exact edge picking remaining lazy and separate; it is not a
requirement until visual parity, interaction identity, transparency, wide-line
behavior, and GPU/memory gains are demonstrated.

## Invariants

- CPU scene and part data remain authoritative; renderer resources are derived.
- Reduced-surface parts never acquire identities or geometry absent from their
  payload.
- Complete-model behavior is independent of compact-skin versus full residency.
- Geometry is shared by part definition and visibility signature, never copied
  merely because a part has multiple placements.
- Every rendered and picked face or edge maps to a stable supplied identity.
- Resource retention and transition peaks remain within measured byte budgets.
- Ordinary all-visible rendering keeps the compact exterior path.

## Decision gate

1. **Value:** support server-reduced transfer and complete local inspection
   without forcing the worst CPU, GPU-memory, and steady-frame cost on both.
2. **Minimum:** retain the two existing authoring contracts and add only an
   internal, bounded compact-skin strategy for complete models.
3. **Deletion/simplification:** replace the global “any hidden means full draw”
   switch when compact skins are proven; do not add a parallel scene graph.
4. **Out of scope:** femgx-owned server requests, streaming, progressive
   refinement, topology reconstruction, spatial partitioning, and public cache
   controls.
5. **Public API:** no new symbol is currently necessary. `surfacePart()` versus
   `elementPart()` already expresses the semantic choice.

[rendering/face-subsets|Face subsets]: face-subsets.md
[requirements/product-scope|Product scope]: ../requirements/product-scope.md
[requirements/surface-derived-part-authoring|Surface-derived part authoring]: ../requirements/surface-derived-part-authoring.md
