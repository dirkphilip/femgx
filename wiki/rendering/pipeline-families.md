# Render pipeline families

This is the authoritative ownership map for every WebGPU render-pipeline
creation module. A pipeline is justified only when it appears here as either a
variant of one semantic family or a narrowly defined singleton. The repository
test discovers pipeline-creation modules under `src/renderer/` and fails when a
module is not linked from this catalog.

Related: [[rendering/shader-variants|Explicit shader variants]],
[[rendering/order-independent-transparency|Order-independent transparency]],
[[rendering/node-face-interaction|Node and face interaction]].

## Ownership rule

One semantic family owns its complete geometry contract: vertex module and
entry point, vertex-buffer layout, primitive topology and culling, plus any
other invariant required to interpret its draw calls. Visible, transparent,
hidden, picking, resolved, and multisample variants compose only pass policy:
fragment entry, color/depth targets, blending, depth/stencil state, and sample
count. A caller selects a named family variant; it does not restate or override
geometry.

Keep family builders constrained to the variants the renderer actually uses.
Do not replace this map with a universal descriptor/options matrix, and do not
expose pipeline-family contracts as public API. A true singleton must state why
it has no sibling with which geometry could drift.

## Creation boundary

- [Validated pipeline construction](../../src/renderer/diagnostics/validation.ts)
  is infrastructure, not a renderable family. Renderer initialization uses its
  asynchronous validation path. The active-edge-only overlay depth singleton is
  the sole current direct-construction exception because it is materialized
  synchronously during a frame; changing that lifecycle requires a separate
  design.

## Scene geometry families

| Family                                             | Creation owner                                                                                                                                     | Family-owned geometry                                                                                                                                                                                                                                  | Legitimate variants                                                                                                                  |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| Instanced triangle, expanded line, and point glyph | [Primitive pipelines](../../src/renderer/shaders/primitive-pipelines.ts); [Selection pipelines](../../src/renderer/shaders/selection-pipelines.ts) | `instancedPrimitiveGeometry` in `src/renderer/shaders/instanced-primitive-geometry.ts` owns the entry point, vertex layout, triangle-list topology, no-cull state, and default depth comparison; each caller supplies its role-specific vertex module. | Opaque color, weighted transparency, four-target picking, dense-selection triangle depth bias, and depth-visible/occluded selection. |
| Minimal instanced triangles                        | [Minimal pipeline](../../src/renderer/shaders/minimal-pipeline.ts)                                                                                 | One minimal triangle vertex program, empty vertex-buffer layout, triangle list, and no culling.                                                                                                                                                        | Opaque color and weighted transparency.                                                                                              |
| Selection geometry                                 | [Selection pipelines](../../src/renderer/shaders/selection-pipelines.ts)                                                                           | Specialized selection shaders use the shared instanced primitive geometry contract; procedural node variants consume the node-sprite contract instead of restating it.                                                                                 | Depth-visible color and occluded weighted ghost; expanded and compact node orderings are named geometry variants.                    |
| Procedural FE-node sprites                         | [Node overlay pipelines](../../src/renderer/shaders/node-overlay.ts)                                                                               | `nodeSpritePipelineGeometry` owns expanded/compact vertex entries, no vertex buffers, triangle strip, and no culling for the four emitted vertices.                                                                                                    | MSAA alpha-to-coverage annotations, resolved single-sample annotations, and selection visible/ghost passes.                          |

The instanced primitive and selection owners retain distinct vertex modules and
binding contracts while consuming one private geometry owner. Pass policy stays
at each creation owner. Procedural node sprites remain a separate family.

## Presentation families

| Family                           | Creation owner                                                                    | Family-owned geometry                                                                 | Legitimate variants                                           |
| -------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Native presentation edges        | [Pipeline resource builder](../../src/renderer/shaders/pipeline-builders.ts)      | One edge vertex/fragment pair, position layout, line list, and no culling.            | Resolved depth-tested and MSAA always-visible color passes.   |
| Authored orientation/load glyphs | [Orientation glyph pipelines](../../src/renderer/orientation-glyphs/pipelines.ts) | One procedural glyph vertex entry, no vertex buffers, triangle list, and no culling.  | Depth-visible color and occluded weighted ghost.              |
| World-origin triad               | [Origin-triad pipelines](../../src/renderer/overlays/origin-triad.ts)             | `triadPipelineDescriptor` owns the triad vertex entry, triangle list, and no culling. | Depth-visible opaque axes and stencil-bounded weighted ghost. |
| Orbit pivot                      | [Orbit-pivot pipelines](../../src/renderer/overlays/orbit-pivot.ts)               | One pivot vertex entry, triangle list, and shared multisample state.                  | Depth-visible color and occluded weighted ghost.              |

## Picking and frame singletons

| Path                            | Creation owner                                                              | Why it is a singleton                                                                                                                                         |
| ------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authored-edge pick expansion    | [Edge-pick pipeline](../../src/renderer/edges/edge-pick-pipeline.ts)        | One lazy, one-sample exact-edge identity pass with its own expanded triangle geometry and single pick target; it is not the native presentation-edge family.  |
| Viewport background             | [Background pipeline](../../src/renderer/frame/background.ts)               | One full-screen triangle pass that writes only the configured renderer background.                                                                            |
| Resolved presentation depth     | [Overlay-depth pipeline](../../src/renderer/frame/overlay-depth.ts)         | One active-edge-only full-screen triangle that conservatively resolves multisampled depth into a single-sample depth target. It has no color or sibling pass. |
| Weighted-transparency composite | [Transparency composite pipeline](../../src/renderer/frame/transparency.ts) | One full-screen triangle that combines accumulation/revealage textures into the swap chain.                                                                   |

Adding a pipeline requires updating this catalog in the same change. If the new
path is a sibling of an existing semantic renderable, extend that family's
constrained builder/spec; a new creation owner or copied geometry descriptor is
not justified merely because its pass policy differs.

[rendering/node-face-interaction|Node and face interaction]: node-face-interaction.md
[rendering/order-independent-transparency|Order-independent transparency]: order-independent-transparency.md
[rendering/shader-variants|Explicit shader variants]: shader-variants.md
