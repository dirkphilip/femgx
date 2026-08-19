# Selection through occlusion

Selection presentation is a renderer-owned overlay derived from
`InteractionState`; it never changes scene geometry, materials, or pick ids.
Visible selected fragments classify the resolved base alpha: an opaque base
fragment emits an opaque semantic cue, while a fractional base alpha is
preserved for translucent inspection. The visible pass still does not write
depth, so the shared opaque scene depth keeps the cue on the front surface and
the subsequent weighted transparency pass remains free to compose the
interior. Selected fragments behind opaque/visible selection depth join the
existing weighted OIT targets at a fixed restrained alpha, so partial
occlusion naturally produces both strong and ghosted regions.

Part and instance selection uses the selected bit in the existing instance
record. Body, element, face, and node selection uses the existing emphasis
record's trailing padding word. Per-part selection and selected-node orders are
compact and preserve the same stable slot/geometry/deformation buffers as the
ordinary passes. Hidden runtime instances and hidden body owners never reach a
selection fragment; alpha-zero style overrides still retain a selection cue.

The visible selection pass uses `less-equal`, alpha blending, no depth writes,
and a dedicated stencil bit. Its unlit color is a bounded tint over the authored
result color when result mapping is active, keeping the selection cue uniform
across one target's visible faces. Its pipeline applies a native one-unit depth
bias so an exact-depth cue wins regardless of opaque submission order. Selected
triangles reuse the ordinary surface position without pick-target expansion, so
equal-depth classification cannot expose individual tessellation triangles.
The visible alpha is `1` when the
resolved base alpha is `1`; otherwise it remains the resolved fractional base
alpha. The hidden pass uses `greater`, no depth or stencil writes, and the same
weighted transparency blend as the ordinary transparent scene. Selection
color and opacity layers therefore preserve translucent inspection without
making a solid selected surface read as a translucent volume. This keeps
hover/highlight depth-tested and leaves selection identity out of picking.

Dense element selection keeps the complete-selection fast path in the ordinary
surface draw; it does not restore a full selected-geometry replay. Only while a
part has dense selection does its color draw admit a native one-unit depth-bias
variant. Both variants retain fixed-function surface depth. The selected cue
therefore wins an exact-depth tie regardless of opaque submission order while
genuinely behind geometry remains occluded. Transparent primitives use
`less-equal` depth comparison so an exact-depth selected cue remains visible
without moving the opaque surface that established the depth. A selected theme
color takes precedence over an authored scalar result; opacity-only and
emissive-only selection themes retain the authored result color.
