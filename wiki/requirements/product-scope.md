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

| Area                                                                                                                               | src                | test       | Decision     | Rationale                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------------------------------------------------------------------------------------------------------------- | ------------------ | ---------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WebGPU rendering (parts, assemblies, instancing, visibility, camera, element-level picking, selection/highlight/hover)             | ~7.7k              | ~5.9k      | **Core now** | The product: draw reusable part geometry once, instance it across assembly placements, and drive interaction through per-instance GPU state.                                                                                                                                                                                              |
| Viewport camera transitions, fit-to-selection, and host-scoped `Z` control                                                         | camera + viewport  | same       | **Core now** | One interruptible viewport-owned transition path serves programmatic camera focus and selection fit. Core keyboard interpretation attaches only to a host-supplied event target; the demo delegates instead of owning parallel animation and shortcut logic.                                                                              |
| CPU fallback rendering (2D canvas)                                                                                                 | demo ~0.6k         | e2e lanes  | **Remove**   | A second renderer for non-target environments. WebGPU is a hard product requirement; without it the caller gets a typed unsupported result. Removed in #171.                                                                                                                                                                              |
| Capability probing + device-loss recovery                                                                                          | ~0.4k              | ~0.6k      | **Core now** | Typed unsupported reporting (`queryWebGpuSupport`) and device-loss recovery (`recover()`) are supported-path features of the WebGPU contract, retained in #171; do not turn them into fallback machinery.                                                                                                                                 |
| Linear element shapes (point, line, triangle, quad, Tet4, Hex8) + canonical topology                                               | ~0.6k              | ~1.2k      | **Core now** | The minimum FE geometry the product must render.                                                                                                                                                                                                                                                                                          |
| Quadratic element shapes (Line3/Tri6/Quad8/Tet10/Hex20) + linear mid-edge tessellation                                             | elements/renderer  | same       | **Core now** | Higher-order connectivity is supported and rendered as deterministic straight segments/facets through authored mid-edge nodes; exact curved interpolation is out of scope.                                                                                                                                                                |
| FE node annotations                                                                                                                | renderer + demo    | same       | **Core now** | Depth testing hides occluded node samples; translucent 6 CSS-px front circles (DPR-scaled) preserve surfaces without overlap accumulation or zoom-dependent depth offsets.                                                                                                                                                                |
| Optional edge / face display overlays                                                                                              | renderer + demo    | same       | **Deferred** | Display polish beyond the renderer-owned edge overlay and core node annotations is not the minimum product.                                                                                                                                                                                                                               |
| GPU picking (element + node strict; face Core) with host-mappable ids                                                              | viewport + picking | same       | **Core now** | `FemViewport.pick` returns a complete `PickHit`; hosts map it with `interactionTargetFromHit`. Node and element ids are strict product requirements; face is Core. Multi-hit `pickMany` is future (below), not Core-now.                                                                                                                  |
| CPU raycast picking (`createPickScene` / `pick()`)                                                                                 | —                  | —          | **Remove**   | Replaced by the GPU pick path; deleted with the flat-compile cleanup.                                                                                                                                                                                                                                                                     |
| Adjacency inspection overlays / pick-list UI polish                                                                                | demo               | e2e        | **Deferred** | Host-mappable neighbor ids on `PickHit` stay; rich adjacency workbench polish is optional.                                                                                                                                                                                                                                                |
| Results fields + derived quantities (magnitude, von Mises, principal), value ranges, scalar color mapping, deformed-shape geometry | ~0.8k              | ~0.9k      | **Core now** | Typed result visualization is core FE value.                                                                                                                                                                                                                                                                                              |
| Advanced results playback (CasePlayer, interpolation) and legends                                                                  | —                  | —          | **Remove**   | Deleted; core results keep fields, derived quantities, scalar color mapping, and deformed shape without playback or legend helpers.                                                                                                                                                                                                       |
| IO: VTK legacy read/write + shared validation and diagnostics                                                                      | ~1.0k              | ~0.9k      | **Core now** | One interchange format is the minimum; VTK legacy is the smallest faithful FE format.                                                                                                                                                                                                                                                     |
| IO: GLB 2.0 display-scene import                                                                                                   | new                | new        | **Core now** | Explicit narrow CAD-display addition from #422: bytes-only import into existing `Part`/`Scene`/`FemViewport` concepts, with hierarchy, reusable tessellated triangles, names, basic color/alpha, and verified Onshape compression coverage. It does not add FE semantics or a second scene graph.                                         |
| IO: VTU, Gmsh, Abaqus adapters, cancellation/progress                                                                              | —                  | —          | **Remove**   | Deleted; product keeps a single VTK legacy interchange path.                                                                                                                                                                                                                                                                              |
| Large-model streaming (spatial partitioning, LOD, upload budgets, worker parsing, coordinate rebasing)                             | —                  | —          | **Remove**   | Deleted; in-memory models are the product path.                                                                                                                                                                                                                                                                                           |
| Deformation (per-vertex displacement)                                                                                              | renderer + results | renderer   | **Core now** | Part of results visualization.                                                                                                                                                                                                                                                                                                            |
| Package smoke tests, e2e coverage, benchmarks and budgets                                                                          | scripts            | test/bench | **Core now** | Engineering gate stays; the e2e contract becomes WebGPU-only.                                                                                                                                                                                                                                                                             |
| Compatibility reporting (capability tiers/matrix)                                                                                  | wiki               | —          | **Deferred** | Collapses to "modern WebGPU browser or typed unsupported"; no tier ladder.                                                                                                                                                                                                                                                                |
| Screen-space box-selection gesture/event shell + world-space frustum query (primary mouse/pen drag lifecycle + typed events)       | interaction/camera | same       | **Core now** | `installBoxSelection` remains a rectangle-only renderer-independent drag lifecycle. `boxSelectionFrustum(camera, rect)` exposes six named normalized inward planes for host-owned volume queries, while `FemViewport.pickRegion` retains nearest-visible GPU target discovery; both are required and selection policy remains host-owned. |

## Recommended smallest supported product

femgx 0.x renders finite-element models in a **modern WebGPU browser**. A model
is defined as reusable part geometry (Point, Line, Line3, Triangle, Tri6, Quad,
Quad8, Tet4, Tet10, Hex8, and Hex20) placed by hierarchical assemblies, compiled once
into a packed scene runtime, and drawn with instanced WebGPU draws batched by
part. The renderer provides GPU picking with host-mappable part/instance/
element/face/node ids (node and element strict; face Core), readable
depth-tested node annotations, selection/
highlight/hover, visibility, camera control, results fields with derived
quantities and scalar color mapping, deformed-shape geometry, and renderer-owned
`studio`, `white`, and `dark` viewport backgrounds. Interchange is a single
format (VTK legacy) with validation and diagnostics. Browsers without
a working WebGPU device receive a typed
unsupported result — never a second renderer.

## Core camera focus contract

`FemViewport` owns one interruptible camera-transition path for programmatic
camera changes and fit-to-selection. An omitted or zero duration applies the
destination immediately; a positive finite duration interpolates smoothly and
lands on the exact protected destination. The default `Z` action fits the
selected visible occurrences, or the complete scene when no eligible selection
exists, over approximately 400 milliseconds. Selection determines the framing target,
while the complete displayed scene remains protected from camera-plane crossing
and clipping throughout the transition.

Keyboard interpretation is core behavior, but listener ownership is explicit:
the host supplies an event target and the library installs no implicit global
listener. Editable targets, modified shortcuts, and key repeat must not trigger
or restart the action. Direct manipulation, a subsequent camera command, scene
replacement, or viewport destruction interrupts the active transition without
jumping to either endpoint. The demo delegates to this contract and removes its
parallel transition scheduler, selection-bounds calculation, and `Z` handler.

This requirement does not introduce a generic timeline, spring system, camera
path editor, shortcut manager, or finer-than-occurrence selection bounds. The
detailed implementation work and acceptance criteria are tracked in
[issue #475](https://github.com/dirkphilip/femgx/issues/475).

Core style opacity uses order-independent weighted transparency for fractional
alpha while preserving instanced batching and nearest-geometry picking; alpha
zero is visually absent but remains pickable. Edge overlays inherit that
resolved opacity, while node annotation membership is controlled by
part/instance style flags and Point parts use their primary glyph without a
duplicate overlay.

Everything outside the "Core now" rows is **not** a requirement of the minimum
product.

The GLB row is a deliberate exception to the single-FE-format rule. VTK remains
the only interchange format for nodes, elements, sets, metadata, and results;
GLB is only a display-scene source for tessellated CAD geometry. The importer
accepts self-contained GLB 2.0 bytes, maps into the canonical scene hierarchy,
and leaves textures, PBR extras, animation, lights, FE identities, and unit
conversion out of scope.

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
  Quad, Quad8, Tet4, Tet10, Hex8, and Hex20 set remain outside the product and require an
  explicit decision before implementation.
- Results playback / legends, IO breadth beyond VTK, and large-model streaming
  → **removed** (explicit product cleanup).

[#decision-gate|decision gate]: product-scope.md#decision-gate
[architecture/architecture-overview|Architecture overview]: ../architecture/architecture-overview.md
[requirements/index|Requirements index]: index.md
