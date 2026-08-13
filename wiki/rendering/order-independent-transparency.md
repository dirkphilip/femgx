# Order-independent transparency

`StyleOverride.opacity` is rendered through an internal weighted-blended OIT
path. The renderer keeps the existing instanced opaque draw, then accumulates
fractional-alpha triangle, line, and point fragments into multisampled
accumulation/revealage targets before compositing them over the resolved opaque
image. Transparent fragments depth-test against opaque geometry and never write
depth. This is an approximation for stable intersecting and instanced geometry,
not physically exact transparency: femgx does not globally sort triangles or
clone materials, and alpha-zero remains visually absent but pickable.

The visible frame has one deliberate presentation ordering:

| Stage                                                         | Color target                       | Depth                                                    | Blend/write                                               | Owner                                                                   |
| ------------------------------------------------------------- | ---------------------------------- | -------------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------- |
| Opaque scene + visible selection + triad/pivot + point replay | MSAA canvas, resolved opaque color | `less` scene, `less-equal` selection/triad/pivot/points  | Alpha-blended selection; triad uses separate stencil bits | Surface batches, selection, world-origin and orbit presentation, points |
| Transparency + hidden selection/triad/pivot                   | Accumulation + revealage           | `less` scene, `greater` selection/triad/pivot, no writes | Weighted accumulation/revealage                           | Fractional scene and fixed-alpha selection/presentation ghosts          |
| Composite                                                     | Swap-chain color                   | Always, no write                                         | Transparent color over opaque color                       | Full-screen OIT composite                                               |
| Presentation helpers                                          | Swap-chain color                   | Explicit helper rule                                     | Helper-specific                                           | Edges, nodes, orientation gizmo                                         |

The origin triad is a renderer-owned two-variant exception. Its positive
world-space X/Y/Z geometry is anchored at `[0, 0, 0]` and scaled each visible
frame from the current camera depth for a nominal 56 CSS-pixel axis length. The opaque scene
draws first; the triad then uses `less-equal` without writing depth and replaces
one stencil bit for visible samples. Point primitives replay with their exact
scene depth so the origin marker does not erase authored point glyphs.
Opaque-occluded triad fragments use the inverse depth comparison and reject that
stencil bit before joining the existing weighted targets at one fixed alpha.
The triad is not scene geometry, is absent from picking and bounds, and has no
public material or visibility mode. The lower-left
orientation gizmo is a separate screen-space control, while the temporary
orbit pivot remains an active-gesture helper with its own depth contract.

Selection has the same two-stage depth shape but is derived from the semantic
selection collections in `InteractionState`. Visible selected fragments use a
bounded alpha-blended tint, do not write depth, and mark a separate stencil
bit; hidden selected fragments use `greater`, do not write depth, and enter
weighted transparency at a fixed restrained alpha. See
[[rendering/selection-occlusion|selection through occlusion]] for the record
and order-buffer ownership details.

The temporary orbit pivot uses the same screen-space geometry for both variants
and uploads its world position, camera-projected axis directions, and fixed DPR
metrics once per active frame. It draws after the opaque scene with `less-equal`
and depth writes, then joins the weighted targets with `greater` and no depth
write after transparent scene batches. The vertex shader preserves the pivot's
projected clip depth rather than forcing it to the near plane, so transparent
geometry in front can blend over the visible marker while opaque-hidden segments
remain a restrained ghost. It is inactive outside an orbit gesture and remains
outside picking and scene identity.

Effective alpha is resolved after the part, instance, body, and element style
layers. Alpha `1` stays in the opaque pass, fractional alpha is accumulated,
and alpha `0` contributes no visible color. The later neutral edge and node
overlays multiply their base coverage by that same resolved instance alpha, so
transparent parts do not leave a shell cage or orphan node dots. The pick pass
still draws all visible instances, so opacity does not create click-through or
multi-hit semantics. Per-part order buffers remain deterministic; no CPU
sorting or material clones are needed.

Resolved style color is a flat per-primitive shader varying. This preserves the
exact alpha written by the CPU: perspective interpolation must not perturb
opaque alpha below `1` and make the opaque-pass classification discard scattered
samples on some GPU backends.

The deterministic `transparency` demo preset contains a translucent shell, a
solid interior, and two overlapping placements of one translucent part. The
real-Chrome e2e lane checks the composed frame and picks the nearest shell face.
