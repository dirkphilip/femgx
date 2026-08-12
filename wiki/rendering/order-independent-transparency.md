# Order-independent transparency

`StyleOverride.opacity` is rendered through an internal weighted-blended OIT
path. The renderer keeps the existing instanced opaque draw, then accumulates
fractional-alpha triangle, line, and point fragments into multisampled
accumulation/revealage targets before compositing them over the resolved opaque
image. Transparent fragments depth-test against opaque geometry and never write
depth; edges, nodes, and the orbit pivot remain later overlays.

Effective alpha is resolved after the part, instance, body, and element style
layers. Alpha `1` stays in the opaque pass, fractional alpha is accumulated,
and alpha `0` contributes no visible color. The later neutral edge and node
overlays multiply their base coverage by that same resolved instance alpha, so
transparent parts do not leave a shell cage or orphan node dots. The pick pass
still draws all visible instances, so opacity does not create click-through or
multi-hit semantics. Per-part order buffers remain deterministic; no CPU
sorting or material clones are needed.

The deterministic `transparency` demo preset contains a translucent shell, a
solid interior, and two overlapping placements of one translucent part. The
real-Chrome e2e lane checks the composed frame and picks the nearest shell face.
