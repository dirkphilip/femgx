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
and a dedicated stencil bit. Its color is a bounded tint over the authored
result color when result mapping is active. Selected triangle surfaces retain
the ordinary two-sided surface lighting, while line, point, and node cues stay
unlit and screen-space legible. The visible alpha is `1` when the
resolved base alpha is `1`; otherwise it remains the resolved fractional base
alpha. The hidden pass uses `greater`, no depth or stencil writes, and the same
weighted transparency blend as the ordinary transparent scene. Selection
color and opacity layers therefore preserve translucent inspection without
making a solid selected surface read as a translucent volume. This keeps
hover/highlight depth-tested and leaves selection identity out of picking.
