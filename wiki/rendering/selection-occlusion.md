# Selection through occlusion

Selection presentation is a renderer-owned overlay derived from
`InteractionState`; it never changes scene geometry, materials, or pick ids.
Selected visible fragments use the resolved semantic selection color as an
opaque depth-writing pass. Selected fragments behind the opaque/visible
selection depth join the existing weighted OIT targets at a fixed restrained
alpha, so partial occlusion naturally produces both strong and ghosted regions.

Part and instance selection uses the selected bit in the existing instance
record. Body, element, face, and node selection uses the existing emphasis
record's trailing padding word. Per-part selection and selected-node orders are
compact and preserve the same stable slot/geometry/deformation buffers as the
ordinary passes. Hidden runtime instances and hidden body owners never reach a
selection fragment; alpha-zero style overrides still retain a selection cue.

The visible selection pass uses `less-equal`, depth writes, and a dedicated
stencil bit. The hidden pass uses `greater`, no depth or stencil writes, and
the same weighted transparency blend as the ordinary transparent scene. This
keeps hover/highlight depth-tested and leaves selection identity out of
picking.
