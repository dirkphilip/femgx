# Product scope and requirements contract

This note is the **source of truth for product scope**. `AGENTS.md` is the
focused agent contract built on it; GitHub issues and pull requests carry the
current work state, while the wiki records durable contracts and rationale. If
another document contradicts this note, this note wins.

Related: [[architecture/architecture-overview|Architecture overview]],
[[requirements/index|Requirements index]].

## Why this contract exists

The repository historically encoded many capabilities as simultaneously
mandatory — CPU fallback rendering, capability probing, device-loss recovery,
four interchange formats, quadratic elements, node/face interaction, advanced
results playback, and large-model streaming. That encouraged scope expansion and
made the minimum product impossible to distinguish from optional capability.
From now on every requirements decision is classified below and every proposed
addition must pass the [[#decision-gate|decision gate]].

## Classifications

- **Core now** — required for the minimum product; the contract requires it.
- **Deferred** — a real future capability, but not a requirement. Do not build,
  expand, or preserve it as mandatory. Existing code may be removed or trimmed
  by a follow-up issue when a product decision calls for it.
- **Remove** — no longer a product goal. Code is scheduled for deletion by an
  explicit issue and must not be extended.

## Decision pass (issue #172)

Line counts are rough `wc -l` totals (source / test) at the time of the audit.

| Area                                                                                                                         | src                | test       | Decision     | Rationale                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------------------------------------------------------------------------------------------------------- | ------------------ | ---------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WebGPU rendering (parts, assemblies, instancing, visibility, camera, element-level picking, selection/highlight/hover)       | ~7.7k              | ~5.9k      | **Core now** | The product: draw reusable part geometry once, instance it across assembly placements, and drive interaction through per-instance GPU state.                                                                                                                                                                                              |
| Viewport camera transitions, fit-to-selection, and host-scoped `Z` control                                                   | camera + viewport  | same       | **Core now** | One interruptible viewport-owned transition path serves programmatic camera focus and selection fit. Core keyboard interpretation attaches only to a host-supplied event target; the demo delegates instead of owning parallel animation and shortcut logic.                                                                              |
| CPU fallback rendering (2D canvas)                                                                                           | demo ~0.6k         | e2e lanes  | **Remove**   | A second renderer for non-target environments. WebGPU is a hard product requirement; without it the caller gets a typed unsupported result. Removed in #171.                                                                                                                                                                              |
| Capability probing + device-loss recovery                                                                                    | ~0.4k              | ~0.6k      | **Core now** | Typed unsupported reporting (`queryWebGpuSupport`) and device-loss recovery (`recover()`) are supported-path features of the WebGPU contract, retained in #171; do not turn them into fallback machinery.                                                                                                                                 |
| Linear element shapes (point, line, triangle, quad, Tet4, Wedge6, Pyramid5, Hex8) + canonical topology                       | ~0.6k              | ~1.2k      | **Core now** | The minimum FE geometry the product must render.                                                                                                                                                                                                                                                                                          |
| Quadratic element shapes (Line3/Tri6/Quad8/Tet10/Hex20) + linear mid-edge tessellation                                       | elements/renderer  | same       | **Core now** | Higher-order connectivity is supported and rendered as deterministic straight segments/facets through authored mid-edge nodes; exact curved interpolation is out of scope.                                                                                                                                                                |
| Authored semantic element blocks and direct/block-defined bodies                                                             | elements/geometry  | same       | **Core now** | `ElementModel` owns optional stable non-overlapping blocks and bodies. Ordinary models retain direct body membership with no synthetic block metadata; block-defined bodies aggregate blocks, and derived primitive parts preserve filtered source identities.                                                                            |
| FE node annotations                                                                                                          | renderer + demo    | same       | **Core now** | Depth testing hides occluded node samples; translucent front circles default to 6 CSS px and are configurable independently from the 8 CSS-px point glyphs in the inclusive `[1,64]` range (DPR-scaled), preserving surfaces without overlap accumulation or zoom-dependent depth offsets.                                                |
| Optional edge / face display overlays                                                                                        | renderer + demo    | same       | **Deferred** | Display polish beyond the renderer-owned edge overlay and core node annotations is not the minimum product.                                                                                                                                                                                                                               |
| GPU picking (element + node strict; face Core) with host-mappable ids                                                        | viewport + picking | same       | **Core now** | `FemViewport.pick` returns a complete `PickHit`; hosts map it with `interactionTargetFromHit`. Node ids are strict; element ownership is present when the hit has an authored element and omitted for truthful node-only point geometry. Face is Core. Multi-hit `pickMany` is future (below), not Core-now.                              |
| Stable authored FE-edge interaction                                                                                          | interaction + GPU  | same       | **Core now** | Occurrence-scoped authored edges support exact picking, hover, selection, highlight, and nearest-visible region selection. Edge-only GPU resources are lazy and absent outside edge granularity; ordinary picking retains its four attachments and inactive cost.                                                                         |
| CPU raycast picking (`createPickScene` / `pick()`)                                                                           | —                  | —          | **Remove**   | Replaced by the GPU pick path; deleted with the flat-compile cleanup.                                                                                                                                                                                                                                                                     |
| Adjacency inspection overlays / pick-list UI polish                                                                          | demo               | e2e        | **Deferred** | Host-mappable neighbor ids on `PickHit` stay; rich adjacency workbench polish is optional.                                                                                                                                                                                                                                                |
| Authored scalar results at nodal or elemental locations, scalar color mapping, and authored nodal deformation                | ~0.8k              | ~0.9k      | **Core now** | The minimum static FE results path: exact authored values map to existing tessellation nodes or element ids; deformation remains a separate authored nodal vector path.                                                                                                                                                                   |
| Authored elemental orientation glyphs                                                                                        | renderer + results | viewport   | **Core now** | A bounded authored `VectorField<"elemental">` role with renderer-owned `arrow`/`axis` glyphs, `direction`/`normal` transforms, and positive element-relative scale. It adds no derived mechanics, glyph picking, or public renderer data.                                                                                                 |
| Derived engineering quantities, other vector/tensor glyphs, magnitude plots, results playback, interpolation, and legends    | —                  | —          | **Deferred** | No femgx-derived values or generalized result-glyph subsystem is in the current product.                                                                                                                                                                                                                                                  |
| IO: VTK legacy read/write + shared validation and diagnostics                                                                | ~1.0k              | ~0.9k      | **Core now** | One interchange format is the minimum; VTK legacy is the smallest faithful FE format.                                                                                                                                                                                                                                                     |
| IO: GLB 2.0 display-scene import                                                                                             | new                | new        | **Core now** | Explicit narrow CAD-display addition from #422: bytes-only import into existing `Part`/`Scene`/`FemViewport` concepts, with hierarchy, reusable tessellated triangles, names, basic color/alpha, and verified Onshape compression coverage. It does not add FE semantics or a second scene graph.                                         |
| IO: VTU, Gmsh, Abaqus adapters, cancellation/progress                                                                        | —                  | —          | **Remove**   | Deleted; product keeps a single VTK legacy interchange path.                                                                                                                                                                                                                                                                              |
| Large-model streaming (spatial partitioning, LOD, upload budgets, worker parsing, coordinate rebasing)                       | —                  | —          | **Remove**   | Deleted; in-memory models are the product path.                                                                                                                                                                                                                                                                                           |
| Deformation (per-vertex displacement)                                                                                        | renderer + results | renderer   | **Core now** | Part of results visualization.                                                                                                                                                                                                                                                                                                            |
| Package smoke tests, e2e coverage, benchmarks and budgets                                                                    | scripts            | test/bench | **Core now** | Engineering gate stays; the e2e contract becomes WebGPU-only.                                                                                                                                                                                                                                                                             |
| Compatibility reporting (capability tiers/matrix)                                                                            | wiki               | —          | **Deferred** | Collapses to "modern WebGPU browser or typed unsupported"; no tier ladder.                                                                                                                                                                                                                                                                |
| Screen-space box-selection gesture/event shell + world-space frustum query (primary mouse/pen drag lifecycle + typed events) | interaction/camera | same       | **Core now** | `installBoxSelection` remains a rectangle-only renderer-independent drag lifecycle. `boxSelectionFrustum(camera, rect)` exposes six named normalized inward planes for host-owned volume queries, while `FemViewport.pickRegion` retains nearest-visible GPU target discovery; both are required and selection policy remains host-owned. |
| Element through-intersection box selection                                                                                   | demo               | same       | **Core now** | The canonical workbench offers an element-only Through strategy that returns every display-eligible FE element occurrence whose authored tessellation intersects the box frustum, regardless of raster occlusion. It is a host-side query over existing scene data and adds no GPU pass, buffer, attachment, or readback.                 |

## Recommended smallest supported product

femgx 0.x renders finite-element models in a **modern WebGPU browser**. A model
is authored as an `ElementModel` with optional stable semantic element blocks
and direct or block-defined bodies, then compiled into reusable part geometry
(Point, Line, Line3, Triangle, Tri6, Quad,
Quad8, Tet4, Tet10, Wedge6, Pyramid5, Hex8, and Hex20) placed by hierarchical assemblies, compiled once
into a packed scene runtime, and drawn with instanced WebGPU draws batched by
part. The renderer provides GPU picking with host-mappable part/instance/
element/face/node ids (node and element strict; face Core), stable authored
FE-edge interaction, readable
depth-tested node annotations, selection/
highlight/hover, visibility, camera control, authored nodal/elemental scalar
results with scalar color mapping, authored nodal deformation, bounded authored
elemental orientation glyphs, visible-surface and element through-intersection
box selection, and renderer-owned `studio`, `white`, and `dark`
viewport backgrounds. Interchange is a single
format (VTK legacy) with validation and diagnostics. Browsers without
a working WebGPU device receive a typed
unsupported result — never a second renderer.

## Core camera focus contract

`FemViewport` owns one interruptible camera-transition path for programmatic
camera changes and fit-to-selection. An omitted or zero duration applies the
destination immediately; a positive finite duration interpolates smoothly and
lands on the exact protected destination. The default `Z` action frames the
selected visible geometry, or the complete scene when no selection exists, over
approximately 400 milliseconds. Part selection frames all visible occurrences;
instance selection frames that occurrence; and body, element, face, or node
selection frames the exact displayed geometry, including active authored
deformation. Multiple selections frame their visible union. Hidden or stale
selections with no resolvable displayed geometry leave the camera unchanged.
Point, line, and flat selections receive deterministic scene-scale padding on
degenerate axes. The complete displayed scene remains protected from
camera-plane crossing and clipping throughout the transition.

Keyboard interpretation is core behavior, but listener ownership is explicit:
the host supplies an event target and the library installs no implicit global
listener. Editable targets, modified shortcuts, and key repeat must not trigger
or restart the action. Direct manipulation, a subsequent camera command, scene
replacement, or viewport destruction interrupts the active transition without
jumping to either endpoint. The demo delegates to this contract and removes its
parallel transition scheduler, selection-bounds calculation, and `Z` handler.

This requirement does not introduce a generic timeline, spring system, camera
path editor, shortcut manager, automatic fit on selection, or a public geometry
query service. The ownership work is tracked in [issue #475](https://github.com/dirkphilip/femgx/issues/475)
and exact selected-geometry framing in [issue #438](https://github.com/dirkphilip/femgx/issues/438).

Core style opacity uses order-independent weighted transparency for fractional
alpha while preserving instanced batching and nearest-geometry picking; alpha
zero is visually absent but remains pickable. Edge overlays inherit that
resolved opacity, while node annotation membership is controlled by
part/instance style flags and Point parts use their primary glyph without a
duplicate overlay.

Authored Line and Line3 elements use a default 2 CSS-pixel screen-space width.
Hosts may set `StyleOverride.lineWidthPixels` on part or instance overrides
only; instance values take precedence and valid values are `[0.5,64]`. The
renderer expands each logical segment once into reusable triangle geometry and
uses at least an 8 CSS-pixel pick footprint. Renderer-owned edge/helper lines
remain on their existing line-list path, and primitive-specific body, element,
face, node, and theme styles do not carry line width.

Every viewport renders one renderer-owned positive world-origin X/Y/Z triad by
default. Hosts may disable it at construction with
`FemViewportOptions.originTriad: false`. When enabled, its nominal positive-axis
length is 12% of the complete placed-scene bounds diagonal, resolved once when
the scene is attached or replaced; it ignores current visibility, deformation,
camera motion, projection, resize, and device pixel ratio. Each visible frame
applies a conservative 56 CSS-pixel maximum to the projected positive-axis
endpoints while preserving ordinary world-axis foreshortening. The triad
remains out of scene identity, bounds, interaction, results, and picking, and
uses opaque depth-visible fragments plus a fixed-alpha weighted-transparency
ghost behind opaque geometry. The triad is presentation behavior, not a public
helper-material or visibility API; the lower-left orientation gizmo and
temporary orbit pivot remain separate helpers.

Everything outside the "Core now" rows is **not** a requirement of the minimum
product.

The GLB row is a deliberate exception to the single-FE-format rule. VTK remains
the only interchange format for nodes, elements, sets, metadata, and results;
GLB is only a display-scene source for tessellated CAD geometry. The importer
accepts self-contained GLB 2.0 bytes, maps into the canonical scene hierarchy,
and leaves textures, PBR extras, animation, lights, FE identities, and unit
conversion out of scope.

Authored elemental orientation glyphs are now a bounded **Core now** role. The
slice uses the existing `VectorField<"elemental">` as authored data, gives `FemViewport` one
orthogonal vector-presentation role alongside scalar coloring and nodal
deformation, and keeps glyph records, anchors, and renderer policy internal.
Its durable semantics and explicit non-goals live in
[[data/vector-field-visualization|Authored elemental orientation visualization]]
and the delivery plan in [issue #665](https://github.com/dirkphilip/femgx/issues/665), completed
through #670.

## Decision gate

Any proposed addition (public API, subsystem, fallback branch, compatibility
layer, optional mode, or scope expansion) must pass before work starts:

1. **User value** — what concrete user-visible value does this deliver, and who
   is the user?
2. **Minimum behavior** — what is the smallest design that delivers that value?
3. **Deletion candidates** — what existing code, abstractions, or scope can be
   deleted or simplified instead of adding?
4. **Non-goals** — what is explicitly out of scope for this addition?
5. **Necessity** — is a new abstraction or public symbol truly necessary, or
   does an existing pattern already cover the case?

A change that grows line count, module count, or abstraction count without
justifying itself against these questions is rejected. A successful
implementation may delete code; deletion-first is the default stance.

## GPU region target discovery

`FemViewport.pickRegion(rect, granularity)` returns unique, deterministic
interaction targets for nearest visible rasterized samples inside a CSS
rectangle. It reads only the requested ID attachments from the cached GPU pick
snapshot, tiles large high-DPI rectangles under a bounded readback budget, and
does not mutate selection, highlighting, or other viewport state. Hidden and
fully occluded geometry is absent; rectangle direction has no meaning. Ordered
multi-hit along a ray (depth peeling / A-buffer), click-through, lasso, and
contained/window semantics remain deferred. Do not grow a parallel CPU
pick-list path.

## World-space box-selection frustum

`boxSelectionFrustum(camera, rect)` is the complementary consumer contract to
`FemViewport.pickRegion`. It returns named `left`, `right`, `top`, `bottom`,
`near`, and `far` planes with unit inward normals. A point is inside or on the
selection volume when `dot(plane.normal, point) + plane.distance >= 0` for all
six planes. Perspective side planes converge at the camera; orthographic side
planes remain parallel. The helper normalizes reversed rectangles, clamps them
to the camera viewport, and rejects non-finite or zero-area inputs. This is a
host query helper, not renderer/runtime frustum culling.

## Element through-intersection selection

The canonical workbench's **Through** strategy uses
`boxSelectionFrustum(camera, rect)` plus authoritative placed FE geometry. It
returns every explicitly display-eligible element occurrence whose current
authored tessellation intersects the six-plane frustum, including occurrences
occluded by nearer geometry. It applies active authored nodal deformation and
instance transforms, respects assembly, part, instance, body, block, element,
and section-plane visibility, and returns stable occurrence-scoped element
targets through the existing selection mutation path.

Visible-surface selection remains the default and continues to use
`FemViewport.pickRegion`. Through is element-only, is intersection rather than
full containment, and does not apply to faces, nodes, edges, bodies, parts,
instances, or GLB display geometry. It is a host-side geometry query and must
not add a GPU pass, buffer, attachment, readback, CPU rendering fallback,
spatial index, or public geometry-query subsystem. Ordered multi-hit point
picking, depth peeling, drag-direction containment rules, and live selection
preview remain deferred.

## Authored FE-edge interaction

Stable authored FE-edge interaction is **Core now**. An edge is the canonical
ordered authored node sequence from FE topology, including a quadratic
mid-edge node where present. Repeated placements produce distinct
occurrence-scoped targets; shared edges retain deterministic incidence without
choosing an arbitrary owning element. Renderer overlay segments, line elements,
and tessellation diagonals are not edge identities.

The minimum behavior is exact edge picking, hover, selection, highlight, and
nearest-visible `FemViewport.pickRegion(rect, "edge")` behavior through the
existing interaction path. Exact emphasis remains available when the optional
presentation edge overlay is disabled. Through/contained edge selection, CAD
curve identity, inferred crease edges, edge editing, per-edge authored styling,
and a generic subentity graph remain out of scope.

Inactive edge interaction must preserve the ordinary renderer cost. The normal
pick snapshot retains its existing four attachments and readback layout;
edge-specific textures, pipelines, geometry, bind groups, draws, and readback
buffers remain absent until edge granularity is explicitly requested. Models
without authored interactive edges allocate no edge identity resources, and
leaving edge granularity adds no per-frame work. The active path's allocations,
pick cost, readback, recovery behavior, and retained-resource policy must be
measured. Add a disabled-by-default viewport capability option only if this
on-demand separation cannot be implemented cleanly.

The delivery contract and evidence are tracked in
[issue #661](https://github.com/dirkphilip/femgx/issues/661).

## Deletion tracking

Removals are implemented by their owning issues, not speculatively here:

- CPU fallback rendering (and the raycast-fallback picker) → **removed in #171**
  (Simplify the product around modern WebGPU requirements). Capability probing
  and device-loss recovery were reviewed there and **retained** as supported-path
  features of the WebGPU contract.
- Flat `compileScene` snapshot and CPU raycast stack (`createPickScene` /
  `pick()`) → **removed**; the product path is `createSceneRuntime` + GPU
  `FemViewport.pick`.
- Element families beyond the supported Point, Line, Line3, Triangle, Tri6,
  Quad, Quad8, Tet4, Tet10, Wedge6, Pyramid5, Hex8, and Hex20 set remain outside the product and require an
  explicit decision before implementation.
- Derived engineering results, result glyphs/playback/legends, IO breadth beyond
  VTK, and large-model streaming → **deferred or removed** (explicit product
  scope).

[#decision-gate|decision gate]: product-scope.md#decision-gate
[architecture/architecture-overview|Architecture overview]: ../architecture/architecture-overview.md
[requirements/index|Requirements index]: index.md
