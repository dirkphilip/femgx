# Topology ownership and residency

This note separates host-owned model residency, femgx scene updates, and
renderer-owned GPU resources. Related: [[requirements/product-scope|Product
scope]], [[requirements/surface-derived-part-authoring|Surface-derived part
authoring]], [[rendering/face-subsets|Face subsets]], and
[[engineering/gpu-performance|GPU rendering performance]].

## Product contracts

The product supports three host data contracts. They are expressed by the data
and update lifecycle, not by a renderer quality enum.

| Contract             | Client state                                                           | Interior behavior                                                      |
| -------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Surface snapshot     | One authoritative `surfacePart()` payload                              | Omitted geometry is unavailable. Local hiding may leave a hole.        |
| Host-updated surface | The latest authoritative `surfacePart()` revision supplied by the host | Newly exposed geometry appears only when the host publishes new state. |
| Fully resident model | Complete `ElementModel` topology and reusable geometry                 | Body/element visibility can reveal retained interiors locally.         |

In both surface contracts, the supplied payload is complete from femgx's point
of view. femgx never infers an omitted neighbor, creates an interior identity,
or reconstructs a skin.

## Host-driven surface updates

Host-updated surface residency is deliberately not a femgx request protocol.
When a client/server host applies a visibility operation to a server-owned
surface shell, the host already knows the authoritative shell must change. It
updates its server state and supplies the resulting part revision or occurrence
binding to femgx. The viewport must not intercept the hide, send a duplicate
request, wait on transport, or keep a shadow copy of server state.

Instances of one part definition always share identical resident geometry:

- If an update changes only transform, style, or state over already-resident
  identities, patch that occurrence.
- If exposed geometry changes identically for all occurrences, publish one new
  shared part revision.
- If only some occurrences differ, bind them to a shared content-identical
  variant or to distinct variants.

Different surfaces necessarily require distinct logical geometry definitions.
Semantic element blocks do not exist and cannot avoid that cost. A server or
renderer may transfer and retain content-addressed immutable chunks so variants
share unchanged bytes, but chunks are private storage: they have no scene,
selection, visibility, style, result, or picking identity.

The existing `FemViewport.updateScene(scene)` path applies these revisions
incrementally after the next packed runtime is available. Stable placement
identities retain their part-local instance slots; a transform/style-only
change patches that occurrence, a rebind patches only the source and
destination part storage/orders, and a new variant uploads only when its part
geometry is first drawn. Unchanged part resources and unrelated occurrence
buffers retain their object identity. Removing a part from the authoritative
scene releases its old geometry and placement resources; femgx does not keep an
implicit historical variant cache. Results, deformation, picks, and interaction
references continue to be reconciled by the existing public identity rules.

Variant residency uses byte budgets. Identical variants are deduplicated,
current variants are pinned, and inactive revisions may be evicted
least-recently-used. If many simultaneous variants approach the cost of a full
model, the host may explicitly upgrade to a fully resident part; femgx does not
silently expand a surface contract.

## Fully resident visibility

The current fully resident strategy uploads complete reusable geometry and may
use an exterior `faceSubset` for ordinary submission. Hiding a body or element
switches affected draws to retained complete topology and filters faces in the
shader. This is a correctness path for the full contract, not surface streaming.

A future internal compact-skin strategy may group occurrences of the same part
by immutable body/element visibility signature and share one draw order per
signature. It must remain observationally equivalent to full residency and use
the same stable identities for color, transparency, selection, picking, nodes,
and edges. It is not a public hierarchy or renderer mode.

## Optional bodies and interaction resources

Bodies own elements directly. A bodyless model has no model-scaled body map,
ownership topology, interaction allocation, or shader work. A fixed empty
sentinel is acceptable when required by a shared bind-group layout.

Display and interaction residency are independent. Showing authored edges or
nodes does not require exact edge/node pick resources. Fine-grained resources
are materialized only when their granularity or active state requires them:

- Empty selection and visibility use fixed empty buffers.
- Small exception sets use sparse records.
- Broad sets may use compact ordinal bitsets.
- Exact edge-pick geometry remains separate and lazy.
- Fast and feature-rich pipelines share one canonical geometry representation.

## Renderer admission and dense overlays

The renderer selects the cheapest correct pipeline per occurrence group.
Ordinary occurrences can use minimal presentation shaders; occurrences with
body/element visibility, section clipping, or fine-grained emphasis use feature
paths. Admission changes only when authoritative state changes and must not scan
the full scene each frame. Pipeline objects are cached per device, not rebuilt
per model or Performance Lab case.

Dense exterior presentation uses the measured overlay path:

- Surfaces and weighted transparency retain 4× MSAA.
- Active edge presentation resolves opaque depth once, then draws into the
  resolved color target at 1×. Nodes join that pass when edges are active;
  nodes-only presentation retains 4× MSAA.
- Presentation edges use compact authored endpoints as one-device-pixel native
  lines. Exact edge picking keeps separate lazy screen-space-width quads.
- Node display and node interaction data remain separable so a high-performance
  presentation does not imply FE-scale selection storage.

The `instanced-2.10m` 800×600 DPR1 system-Chrome case measured approximately
120 FPS for surface-only and edge presentation and approximately 65 FPS for the
combined edge/node view after the native-edge fast path. CPU encoding remains
about 0.1 ms p50; node fragment coverage and overdraw are the next measured GPU
target.

## Invariants

- CPU scene and host-supplied part data remain authoritative.
- A reduced surface never acquires absent identities or geometry.
- femgx consumes host updates; it does not initiate server visibility requests.
- One part definition has identical geometry for all of its occurrences.
- Geometry variants share by content where possible and remain budgeted.
- Private chunks never become public semantic identities.
- Omitted bodies and inactive fine interaction add no model-scaled memory or
  steady-frame work.
- Fast and feature paths preserve exact visible, picking, and interaction
  semantics for the capabilities admitted to that path.

## Decision gate

1. **Value:** support thin client/server shells, full local inspection, and a
   high-performance presentation path without conflating them.
2. **Minimum:** three host residency contracts, host-driven replacement, direct
   body membership, and renderer-owned lazy resource admission.
3. **Deletion/simplification:** keep transfer chunks private and avoid
   duplicate request logic or a second semantic grouping layer.
4. **Out of scope:** femgx-owned transport, server requests, topology inference,
   progressive refinement, public cache controls, and arbitrary capability
   flag combinations.
5. **Public API:** no renderer residency enum is required. Existing
   `surfacePart()`/`elementPart()` data plus host scene updates express the
   contract; any later interaction-detail profile requires its own API decision.

[rendering/face-subsets|Face subsets]: face-subsets.md
[engineering/gpu-performance|GPU rendering performance]: ../engineering/gpu-performance.md
[requirements/product-scope|Product scope]: ../requirements/product-scope.md
[requirements/surface-derived-part-authoring|Surface-derived part authoring]: ../requirements/surface-derived-part-authoring.md
