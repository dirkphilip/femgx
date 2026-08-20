# Order-independent transparency

`StyleOverride.opacity` is rendered through an internal weighted-blended OIT
path. The renderer keeps the existing instanced opaque draw, then accumulates
fractional-alpha triangle, line, and point fragments into multisampled
accumulation/revealage targets before compositing them over the resolved opaque
image. Accumulation uses `rgba16float`; scalar revealage uses `r8unorm`, including
its multisampled and resolved targets. Transparent fragments depth-test against
opaque geometry and never write depth. This is an approximation for stable
intersecting and instanced geometry, not physically exact transparency: femgx
does not globally sort triangles or clone materials, and alpha-zero remains
visually absent but pickable.

The visible frame has one deliberate presentation ordering:

Within the authored opaque scene stage, the existing single color/pick pass
submits triangle, line, then point part groups. This only defines exact-depth
ties; ordinary depth still selects the nearest fragment. Renderer-owned edges
and node annotations remain post-composite presentation helpers, outside this
authored primitive precedence.

| Stage                                                         | Color target                                     | Depth                                                    | Blend/write                                               | Owner                                                                   |
| ------------------------------------------------------------- | ------------------------------------------------ | -------------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------- |
| Opaque scene + visible selection + triad/pivot + point replay | MSAA canvas, resolved opaque color               | `less` scene, `less-equal` selection/triad/pivot/points  | Alpha-blended selection; triad uses separate stencil bits | Surface batches, selection, world-origin and orbit presentation, points |
| Transparency + hidden selection/triad/pivot                   | `rgba16float` accumulation + `r8unorm` revealage | `less` scene, `greater` selection/triad/pivot, no writes | Weighted accumulation/revealage                           | Fractional scene and fixed-alpha selection/presentation ghosts          |
| Composite                                                     | Swap-chain color                                 | Always, no write                                         | Transparent color over opaque color                       | Full-screen OIT composite                                               |
| No weighted contributor                                       | Swap-chain color                                 | Existing opaque depth contract                           | Direct MSAA resolve; no OIT targets or composite          | Opaque scene with edge/node helpers                                     |
| Presentation helpers                                          | Swap-chain color                                 | Explicit helper rule                                     | Helper-specific                                           | Edges, nodes, orientation gizmo                                         |

The origin triad is a renderer-owned two-variant exception. Its positive
world-space X/Y/Z geometry is anchored at `[0, 0, 0]`; its world length and
projected cap follow the single [[rendering/camera-presentation|camera presentation]]
contract. The opaque scene draws first; the triad then uses `less-equal` without
writing depth and replaces one stencil bit for visible samples.
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
and alpha `0` contributes no visible color. For authored scene fragments, the
accumulation weight is the bounded function

```text
safeAlpha = clamp(alpha, 0, 1), treating NaN as 0
safeDepth = clamp(fragmentDepth, 0, 1), treating NaN as 0
weight = clamp(max(0.01, safeAlpha * 8) * (1 - 0.75 * safeDepth), 0.01, 8)
```

`fragmentDepth` is WebGPU's normalized `@builtin(position).z`: `0` is near
the viewport's near plane and `1` is near its far plane. Thus equal-alpha
fragments nearer the camera receive at least as much color influence as
farther fragments, while revealage remains exactly `alpha` and continues to
encode the product of `1 - alpha`. Hidden selection, the origin-triad ghost,
and the orbit-pivot ghost intentionally use the fixed-alpha presentation
weight; depth-aware scene weighting must not let a helper wash out authored
geometry. The lower bound protects sparse fragments and the upper bound keeps
the `rgba16float` accumulation finite under supported overlap. The renderer
derives one internal contributor predicate from fractional scene calls, hidden
selection/node calls, the origin triad, and the active orbit pivot. When none is
present, it resolves the opaque MSAA color directly to the swap chain, draws
edge/node helpers in that same MSAA pass, and retains no OIT-only targets. This
does not inspect pixels or change product semantics. This remains a
weighted-blended approximation: it improves front/back readability but does
not recover exact per-pixel ordering, refraction, thickness, or absorption.

The later neutral edge and node overlays multiply their base coverage by that
same resolved instance alpha, so transparent parts do not leave a shell cage
or orphan node dots. The pick pass still draws all visible instances, so
opacity does not create click-through or multi-hit semantics. Per-part order
buffers remain deterministic; no CPU depth tracking, sorting, or material
clones are needed.

## Perspective result-alpha stability

Resolved style color is a flat per-primitive shader varying, but nodal result
color must remain perspective-interpolated so its RGB gradient follows the
surface. Result alpha therefore travels through the same interpolator even when
every contributing vertex authored the exact opaque value `1`.

Some Windows/NVIDIA shader paths can return an interpolated alpha infinitesimally
below `1`. The opaque fragment shaders previously classified opacity with the
exact condition `alpha < 1`, so those samples were discarded. The resulting
holes appeared as view-dependent white speckles: perspective interpolation
weights change with camera angle and distance, while the tested orthographic
path remained stable. This is a floating-point boundary problem rather than
missing geometry, depth fighting, temporal instability, or a driver-version
feature gap; a current driver may still expose it.

All lit and unlit opaque and weighted-transparency surface fragment paths now
resolve displayed color through one rule. Alpha is clamped to `[0, 1]`, values
at or below `1e-5` become exactly `0`, and values at or above `1 - 1e-5` become
exactly `1`. RGB and meaningful fractional alpha remain unchanged. Keeping the
rule shared prevents the opaque and transparent passes from disagreeing at the
same boundary. Making the complete result color flat would also avoid the
rounding, but would incorrectly remove nodal result interpolation and is not an
acceptable fix.

The revealage attachment format is downstream of this classification. Using
portable `r8unorm` revealage avoids optional float-blending requirements, but a
revealage format change cannot restore a sample already discarded by the opaque
shader and was not the fix for these holes.

The runtime cost is one clamp, two comparisons, and two selects per authored
surface fragment. It adds no pass, draw, buffer, texture, bind group, readback,
CPU work, or memory, and it does not change batching. The expected performance
impact is negligible relative to lighting and rasterization; the only semantic
tradeoff is that alpha within `0.001%` of either endpoint is treated as that
endpoint.

Regression coverage asserts that all four surface fragment paths use the shared
resolver while `resultColor` remains interpolated. The real-Chrome workbench
test also checks stable result-colored perspective frames before and after an
orbit and a zoom. CI does not reproduce every vendor shader compiler, so the
same angle-and-distance check on affected hardware remains the final evidence
for a driver-specific report. The fix and original RTX 2000 Ada report are
tracked in [PR #1155](https://github.com/dirkphilip/femgx/pull/1155).

The deterministic `transparency` demo preset contains a translucent shell, a
solid interior, and two overlapping placements of one translucent part. The
real-Chrome e2e lane checks the composed frame and picks the nearest shell face.
