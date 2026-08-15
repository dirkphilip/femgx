# Authored elemental orientation visualization

Status: **Implemented**. This note defines the narrow direction from
[issue #665](https://github.com/dirkphilip/femgx/issues/665), now composed into
the viewport results API by issue #670.

## User value and ownership

Finite-element users should be able to inspect authored per-element normals and
fiber/material directions in the same instanced scene used for scalar coloring,
nodal deformation, selection, and visibility. The existing
`VectorField<"elemental">` is the data source. `FemViewport` owns the
presentation role and its atomic result transition; `Part`, `Scene`, and
`SceneRuntime` continue to own geometry, authoring, and compiled scene data,
not glyph state.

The role is orthogonal to scalar and deformation roles. Scalar-only,
deformation-only, vector-only, and valid combinations are distinct states; an
empty configuration remains represented by `clearResults()`, not a dummy
field. The current `setResults({ scalar, deformation, vectors })` API
composes these roles atomically; `clearResults()` is the empty transition.

## Authored data and presentation

- Values remain indexed by existing part-local `ElementId` rows and are not
  recomputed from geometry, stress, deformation, or neighboring elements.
- Any non-finite component is missing and emits no glyph. A zero-length vector
  also emits no glyph. Finite vectors are normalized for presentation; their
  magnitude is not displayed or used as glyph length.
- `arrow` is anchored at the element anchor and preserves vector sign.
  `axis` is centered on the anchor and is invariant under `v` ↔ `-v`.
- Glyph length is element-relative with one finite positive scale. The optional
  `widthPixels` config selects a finite 1–8 CSS-pixel shaft width (default 2;
  fractional values are allowed); the renderer applies device-pixel-ratio
  scaling exactly once. Head shape, hidden alpha, and arbitrary glyph meshes
  remain renderer-owned.

## Placement, anchors, and deformation

Components are authored in reusable part-local/model coordinates. Direction
semantics use the occurrence's linear transform. Normal semantics use its
inverse-transpose transform and reject a singular occurrence transform at the
viewport boundary with an actionable error.

An anchor is derived internally from the unique authored element nodes already
available through tessellation and node-pick metadata; no public anchor array
or copied geometry is needed. Nodal deformation moves the anchor using the
mean displacement of those same element nodes. The orientation itself is not
recomputed from a deformation gradient; a host that needs a changed direction
provides a replacement authored field.

## Rendering and interaction

The renderer path reuses one normalized record per eligible element in
each reusable part and draws repeated occurrences through GPU instancing.
Records are uploaded on field/scene changes, not rewritten every frame. Glyphs
follow part, occurrence, body, and element visibility; face-only visibility
does not independently hide an element glyph.

Depth-visible glyph fragments are opaque. Fragments behind opaque model
geometry use one renderer-owned fixed-alpha weighted-transparency ghost. The
orientation presentation remains outside scene identity, bounds, camera fit,
picking, interaction state, scalar values, and export. Device recovery,
scene replacement, and `clearResults()` retain the same ownership boundaries
as the other viewport result roles.

## Explicit non-goals

This direction does not add magnitude plots, derived mechanics, stress or
principal values, nodal/face/integration-point glyphs, tensors, smoothing,
averaging, extrapolation, interpolation, streamlines, particles, playback,
automatic sampling/decimation, glyph picking, glyph bounds, export, solver
specific UI, a second scene graph, a result manager, or a generalized styling
system.

The implementation sequence was documented in #665 and was intentionally
dependency ordered: #666 recorded this contract, #667 owns CPU records and
anchors, #668 owns instanced WebGPU rendering, and #670 composes result roles.

Related: [[data/results|Results, deformation, and scalar visualization]],
[[architecture/api-design|API design north star]],
[[requirements/product-scope|Product scope and requirements contract]], and
[[rendering/order-independent-transparency|Order-independent transparency]].

[data/results|Results, deformation, and scalar visualization]: results.md
[architecture/api-design|API design north star]: ../architecture/api-design.md
[requirements/product-scope|Product scope and requirements contract]: ../requirements/product-scope.md
[rendering/order-independent-transparency|Order-independent transparency]: ../rendering/order-independent-transparency.md
