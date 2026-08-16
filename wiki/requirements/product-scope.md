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
four interchange formats, quadratic elements, node/face interaction,
library-owned results playback, and large-model streaming. That encouraged scope expansion and
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

| Area                                                                                                                                                                                    | src                  | test       | Decision     | Rationale                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | ---------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WebGPU rendering (parts, assemblies, instancing, visibility, camera, element-level picking, selection/highlight/hover)                                                                  | ~7.7k                | ~5.9k      | **Core now** | The product: draw reusable part geometry once, instance it across assembly placements, and drive interaction through per-instance GPU state.                                                                                                                                                                                                                                                                           |
| Viewport camera transitions, fit-to-selection, and host-scoped `Z` control                                                                                                              | camera + viewport    | same       | **Core now** | One interruptible viewport-owned transition path serves programmatic camera focus and selection fit. Core keyboard interpretation attaches only to a host-supplied event target; the demo delegates instead of owning parallel animation and shortcut logic.                                                                                                                                                           |
| CPU fallback rendering (2D canvas)                                                                                                                                                      | demo ~0.6k           | e2e lanes  | **Remove**   | A second renderer for non-target environments. WebGPU is a hard product requirement; without it the caller gets a typed unsupported result. Removed in #171.                                                                                                                                                                                                                                                           |
| Capability probing + device-loss recovery                                                                                                                                               | ~0.4k                | ~0.6k      | **Core now** | Typed unsupported reporting (`queryWebGpuSupport`) and device-loss recovery (`recover()`) are supported-path features of the WebGPU contract, retained in #171; do not turn them into fallback machinery.                                                                                                                                                                                                              |
| Linear element shapes (point, line, triangle, quad, Tet4, Wedge6, Pyramid5, Hex8) + canonical topology                                                                                  | ~0.6k                | ~1.2k      | **Core now** | The minimum FE geometry the product must render.                                                                                                                                                                                                                                                                                                                                                                       |
| Quadratic element shapes (Line3/Tri6/Quad8/Tet10/Hex20) + linear mid-edge tessellation                                                                                                  | elements/renderer    | same       | **Core now** | Higher-order connectivity is supported and rendered as deterministic straight segments/facets through authored mid-edge nodes; exact curved interpolation is out of scope.                                                                                                                                                                                                                                             |
| Optional authored bodies with direct element membership                                                                                                                                 | elements/geometry    | same       | **Core now** | Bodies are useful semantic and interaction groups. `ElementModel` may map elements directly to stable bodies; omitting bodies must add no model-scaled CPU/GPU storage, draw, shader read, or per-frame work.                                                                                                                                                                                                          |
| Authored semantic element blocks                                                                                                                                                        | elements/interaction | same       | **Remove**   | Blocks duplicate body/element grouping without providing independently replaceable geometry. Remove block authoring, editing, identity, picking, interaction, visibility, topology ownership, and GPU records. Transfer or upload chunks remain private implementation details rather than semantic targets.                                                                                                           |
| FE node annotations                                                                                                                                                                     | renderer + demo      | same       | **Core now** | Depth testing hides occluded node samples; translucent front circles default to 6 CSS px and are configurable independently from the 8 CSS-px point glyphs in the inclusive `[1,64]` range (DPR-scaled), preserving surfaces without overlap accumulation or zoom-dependent depth offsets.                                                                                                                             |
| Optional edge / face display overlays                                                                                                                                                   | renderer + demo      | same       | **Deferred** | Display polish beyond the renderer-owned edge overlay and core node annotations is not the minimum product.                                                                                                                                                                                                                                                                                                            |
| GPU picking (element + node strict; face Core) with host-mappable ids                                                                                                                   | viewport + picking   | same       | **Core now** | `FemViewport.pick` returns a complete `PickHit`; hosts map it with `interactionTargetFromHit`. Node ids are strict; element ownership is present when the hit has an authored element and omitted for truthful node-only point geometry. Face is Core. Multi-hit `pickMany` is future (below), not Core-now.                                                                                                           |
| Stable authored FE-edge interaction                                                                                                                                                     | interaction + GPU    | same       | **Core now** | Occurrence-scoped authored edges support exact picking, hover, selection, highlight, and nearest-visible region selection. Edge-only GPU resources are lazy and absent outside edge granularity; ordinary picking retains its four attachments and inactive cost.                                                                                                                                                      |
| CPU raycast picking (`createPickScene` / `pick()`)                                                                                                                                      | —                    | —          | **Remove**   | Replaced by the GPU pick path; deleted with the flat-compile cleanup.                                                                                                                                                                                                                                                                                                                                                  |
| Adjacency inspection overlays / pick-list UI polish                                                                                                                                     | demo                 | e2e        | **Deferred** | Host-mappable neighbor ids on `PickHit` stay; rich adjacency workbench polish is optional.                                                                                                                                                                                                                                                                                                                             |
| Authored result snapshots and host-driven sequencing                                                                                                                                    | results + viewport   | same       | **Core now** | One atomic snapshot combines optional nodal/elemental scalar coloring, nodal deformation, and elemental orientation. Hosts may sequence snapshots through repeated `setResults()` calls on the same scene/runtime; femgx retains only the current snapshot.                                                                                                                                                            |
| Authored elemental orientation glyphs                                                                                                                                                   | renderer + results   | viewport   | **Core now** | A bounded authored `VectorField<"elemental">` role with renderer-owned `arrow`/`axis` glyphs, `direction`/`normal` transforms, and positive element-relative scale. It adds no derived mechanics, glyph picking, or public renderer data.                                                                                                                                                                              |
| Derived engineering quantities, other vector/tensor glyphs, magnitude plots, temporal field interpolation, femgx-owned cases/timelines/playback controls, and a public legend subsystem | —                    | —          | **Deferred** | The minimum product displays exact authored snapshots. It does not create intermediate result states, derive values, retain a sequence, schedule frames, or add generalized result-management or glyph systems.                                                                                                                                                                                                        |
| IO: VTK legacy read/write + shared validation and diagnostics                                                                                                                           | ~1.0k                | ~0.9k      | **Core now** | One interchange format is the minimum; VTK legacy is the smallest faithful FE format.                                                                                                                                                                                                                                                                                                                                  |
| IO: GLB 2.0 display-scene import                                                                                                                                                        | new                  | new        | **Core now** | Explicit narrow CAD-display addition from #422: bytes-only import into existing `Part`/`Scene`/`FemViewport` concepts, with hierarchy, reusable tessellated triangles, names, basic color/alpha, and verified Onshape compression coverage. It does not add FE semantics or a second scene graph.                                                                                                                      |
| Host-supplied surface-derived mixed-part authoring                                                                                                                                      | geometry             | geometry   | **Core now** | The host supplies display-relevant facets, authored lines, and authored points for one reusable part without omitted solid connectivity. This compiles to existing primitive groups and is not library-owned progressive streaming; see [surface-derived part authoring].                                                                                                                                              |
| Exterior-only GPU residency with complete client-side FE topology                                                                                                                       | geometry + renderer  | same       | **Deferred** | The client retains complete topology while WebGPU retains only the current display skin. This is distinct from a face-subset draw order: local visibility changes would have to rebuild or upload the newly exposed skin without submitting or retaining every interior face on the GPU. No public residency mode is required until that lifecycle preserves instancing, interaction, deformation, and bounded memory. |
| IO: VTU, Gmsh, Abaqus adapters, cancellation/progress                                                                                                                                   | —                    | —          | **Remove**   | Deleted; product keeps a single VTK legacy interchange path.                                                                                                                                                                                                                                                                                                                                                           |
| Render coordinates and transforms use single-precision floats                                                                                                                           | elements + geometry  | same       | **Core now** | `FemModel` may retain double-precision interchange coordinates, but conversion into `ElementModel`, reusable geometry, transforms, deformation, and GPU data is intentionally Float32. Hosts author suitable part-local coordinates; mixed-precision rendering and coordinate rebasing remain out of scope.                                                                                                            |
| Renderer-owned large-model streaming (spatial partitioning, level-of-detail, worker parsing, coordinate rebasing)                                                                       | —                    | —          | **Remove**   | Deleted; in-memory models are the renderer product path. Host-supplied complete surface revisions are Core and do not authorize femgx-owned progressive streaming or request orchestration.                                                                                                                                                                                                                            |
| Deformation (per-vertex displacement)                                                                                                                                                   | renderer + results   | renderer   | **Core now** | Part of results visualization.                                                                                                                                                                                                                                                                                                                                                                                         |
| Package smoke tests, e2e coverage, benchmarks and budgets                                                                                                                               | scripts              | test/bench | **Core now** | Engineering gate stays; the e2e contract becomes WebGPU-only.                                                                                                                                                                                                                                                                                                                                                          |
| Compatibility reporting (capability tiers/matrix)                                                                                                                                       | wiki                 | —          | **Deferred** | Collapses to "modern WebGPU browser or typed unsupported"; no tier ladder.                                                                                                                                                                                                                                                                                                                                             |
| Screen-space box-selection gesture/event shell + world-space frustum query (primary mouse/pen and explicitly routed touch drag lifecycle + typed events)                                | interaction/camera   | same       | **Core now** | `installBoxSelection` remains a rectangle-only renderer-independent drag lifecycle. Touch is host-enabled only after routing it away from camera navigation. `boxSelectionFrustum(camera, rect)` exposes six named normalized inward planes for host-owned volume queries, while `FemViewport.pickRegion` retains nearest-visible GPU target discovery; both are required and selection policy remains host-owned.     |
| Element through-intersection box selection                                                                                                                                              | demo                 | same       | **Core now** | The canonical workbench offers an element-only Through strategy that returns every display-eligible FE element occurrence whose authored tessellation intersects the box frustum, regardless of raster occlusion. It is a host-side query over existing scene data and adds no GPU pass, buffer, attachment, or readback.                                                                                              |

## Recommended smallest supported product

femgx 0.x renders finite-element models in a **modern WebGPU browser**. A model
is authored as an `ElementModel` with optional stable bodies that own elements
directly, or supplied as one host-reduced
surface-derived mixed part, then compiled into reusable part geometry
(Point, Line, Line3, Triangle, Tri6, Quad,
Quad8, Tet4, Tet10, Wedge6, Pyramid5, Hex8, and Hex20) placed by hierarchical assemblies, compiled once
into a packed scene runtime, and drawn with instanced WebGPU draws batched by
part. The renderer provides GPU picking with host-mappable part/instance/
element/face/node ids (node and element strict; face Core), stable authored
FE-edge interaction, readable
depth-tested node annotations, selection/
highlight/hover, visibility, camera control, authored nodal/elemental scalar
results with scalar color mapping, authored nodal deformation, efficient
host-driven sequencing of atomic authored result snapshots, bounded authored
elemental orientation glyphs, visible-surface and element through-intersection
box selection, and renderer-owned `studio`, `white`, and `dark`
viewport backgrounds. Interchange is a single
format (VTK legacy) with validation and diagnostics. Browsers without
a working WebGPU device receive a typed
unsupported result — never a second renderer.

The surface-derived path accepts a complete in-memory host payload and does not
restore the removed library-owned streaming subsystem. Its detailed compact
connectivity, identity, memory, and negative-space contract is defined in
[[requirements/surface-derived-part-authoring|surface-derived part authoring]].

## Topology transfer and residency contracts

“Show the surface” is presentation, not a statement about which topology the
client or GPU owns. A host must choose an explicit data contract for each part:

| Contract             | Client owns                                               | Update owner | Local interior reveal                                                           | Status       |
| -------------------- | --------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------- | ------------ |
| Surface snapshot     | One complete display-relevant `surfacePart()` payload     | Host         | No. Omitted topology cannot be rendered or selected.                            | **Core now** |
| Host-updated surface | The latest complete authoritative `surfacePart()` payload | Host/server  | Only after the host supplies a replacement part revision or occurrence binding. | **Core now** |
| Fully resident model | Complete `ElementModel` topology and reusable geometry    | femgx/host   | Yes, because the client retains the relevant faces and identities.              | **Core now** |

The first two contracts are transfer-minimizing paths. In both, femgx treats the
current surface payload as complete and never infers omitted topology. The
host-updated form is a host architecture, not a femgx request lifecycle: when a
host applies a visibility operation to a server-owned shell, it already knows
that authoritative surface state must change and supplies the resulting part
revision or occurrence binding directly. femgx must not intercept the hide,
emit a second request, own transport, or retain shadow server state.

Instances of one part definition share identical resident geometry. A state
change that preserves geometry remains occurrence state. If exposed geometry
changes for every occurrence, the host publishes one shared part revision. If
only a subset differs, those occurrences bind to a content-identical shared
variant or a distinct variant. Transport/upload chunks may be deduplicated
internally, but never become public blocks or interaction identities. Picking,
results, deformation, visibility, bounds, and selection apply only to identities
present in the current client payload.

In the fully resident contract, `elementPart(..., { faceSubset })` is a compact
ordinary draw order rather than a residency boundary. The current renderer may
retain complete geometry on the GPU so that local visibility changes can expose
and interact with interior faces. At present, any hidden body or element
switches those draws from the static exterior subset to the already-resident
complete face order and filters it in the shader; the visibility change does not
infer or upload a new compact skin. This is a correctness fallback for the fully
resident contract, not GPU-surface residency. Hosts that do not want the full
transfer or residency cost must author a `surfacePart()` instead of relying on a
display toggle.

## Optional semantics and rendering admission

Optional bodies and finite-element interaction pay for their capability only
when the authoring payload or active interaction requires it. A bodyless model
has no model-scaled body table, ownership topology, interaction buffer, draw,
shader read, or per-frame body work; a fixed empty sentinel is acceptable.
Bodies own elements directly. There is no semantic block layer.

Display resources are independent from interaction resources. Showing authored
nodes or edges does not by itself require node/edge picking metadata, selection
tables, or visibility masks. Empty selection and visibility state use fixed
empty resources; small state is sparse, while broad state may switch to compact
bitsets rather than allocating one rich record per element.

The renderer admits the cheapest correct pipeline for each occurrence group.
Ordinary occurrences may use a minimal node/edge shader, while occurrences with
body/element visibility, section clipping, or fine-grained emphasis use the
corresponding feature path. Pipeline admission is incrementally derived from
authoritative state, never a per-frame full scan or a public quality switch. All
variants consume one canonical geometry representation; fast and
feature-capable paths must not duplicate full node or edge buffers.

### Block removal contract

The **Remove** classification for semantic element blocks is an implementation
instruction, not deprecation guidance. Follow-up work deletes `ElementBlock`
authoring and edit operations, block-defined bodies, block ids and descriptors,
block interaction targets and state, block hierarchy UI, pick resolution,
topology owner fields, shader conditions, fixtures, tests, documentation, and
public exports. Do not retain aliases, adapters, serialized compatibility, or
dead block fields. Import-format grouping may be consumed transiently by an
adapter but must map to bodies/elements or disappear before the authoritative
model boundary.

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

## Core authored result snapshot sequencing

One `ViewportResultsConfig` is one authored result snapshot. Its scalar,
deformation, and orientation roles are resolved and installed atomically, so a
host can show paired stress and displacement states without exposing a mixed
step. Repeated `FemViewport.setResults()` calls on the same scene/runtime are
the sequencing boundary. Same-layout updates reuse renderer storage where
possible, and recovery retains only the latest installed snapshot.

The host owns any snapshot collection, identity, order, time labels, active
index, timer, playback rate, and controls. It may step or play exact authored
snapshots without introducing a femgx `CasePlayer`, `ResultSeries`, or timeline
API. One scalar field remains the viewport's color channel; deformation and the
bounded elemental orientation role may be composed with it. For a comparable
sequence, the host supplies a shared explicit scalar range instead of allowing
each snapshot to select an unrelated automatic range.

Spatial interpolation of authored nodal colors across existing element
tessellation is part of scalar rendering. Temporal interpolation between
snapshots is distinct and remains deferred: it creates values that were not
authored and requires explicit compatibility, missing-value, endpoint, and
coupled scalar/deformation semantics. Snapshot storage, prefetching, solver
streaming, playback scheduling/UI, history plots, synchronized viewports, and
movie export also remain host concerns. Derived engineering quantities and
generalized result visualization remain outside the product.

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
instance transforms, respects assembly, part, instance, body, element,
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
- Derived engineering results, generalized result glyphs, temporal field
  interpolation, femgx-owned cases/timelines/playback controls, a public legend
  subsystem, IO breadth beyond VTK, and large-model streaming → **deferred or
  removed** (explicit product scope). Exact host-driven snapshot sequencing uses
  the retained `setResults()` boundary and is Core now.

[#decision-gate|decision gate]: product-scope.md#decision-gate
[architecture/architecture-overview|Architecture overview]: ../architecture/architecture-overview.md
[requirements/index|Requirements index]: index.md
[requirements/surface-derived-part-authoring|surface-derived part authoring]: surface-derived-part-authoring.md
[rendering/topology-residency|topology ownership and GPU residency]: ../rendering/topology-residency.md
