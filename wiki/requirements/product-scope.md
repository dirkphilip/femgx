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

| Area                                                                                                                               | src                | test       | Decision     | Rationale                                                                                                                                                                                                 |
| ---------------------------------------------------------------------------------------------------------------------------------- | ------------------ | ---------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WebGPU rendering (parts, assemblies, instancing, visibility, camera, element-level picking, selection/highlight/hover)             | ~7.7k              | ~5.9k      | **Core now** | The product: draw reusable part geometry once, instance it across assembly placements, and drive interaction through per-instance GPU state.                                                              |
| CPU fallback rendering (2D canvas)                                                                                                 | demo ~0.6k         | e2e lanes  | **Remove**   | A second renderer for non-target environments. WebGPU is a hard product requirement; without it the caller gets a typed unsupported result. Removed in #171.                                              |
| Capability probing + device-loss recovery                                                                                          | ~0.4k              | ~0.6k      | **Core now** | Typed unsupported reporting (`queryWebGpuSupport`) and device-loss recovery (`recover()`) are supported-path features of the WebGPU contract, retained in #171; do not turn them into fallback machinery. |
| Linear element shapes (point, line, triangle, quad, Tet4, Hex8) + canonical topology                                               | ~0.6k              | ~1.2k      | **Core now** | The minimum FE geometry the product must render.                                                                                                                                                          |
| Quadratic element shapes (Line3/Tet10/Hex20) + mid-edge tessellation                                                               | elements/renderer  | same       | **Core now** | Curved and higher-order FE geometry is required to represent supported engineering models faithfully; its tessellation cost is an explicit supported-path trade-off.                                      |
| FE node annotations                                                                                                                | renderer + demo    | same       | **Core now** | Depth testing hides occluded node samples; translucent 6 CSS-px front circles (DPR-scaled) preserve surfaces without overlap accumulation or zoom-dependent depth offsets.                                |
| Optional edge / face display overlays                                                                                              | renderer + demo    | same       | **Deferred** | Display polish beyond the existing solid/surface/edges modes and core node annotations is not the minimum product.                                                                                        |
| GPU picking (element + node strict; face Core) with host-mappable ids                                                              | renderer + picking | same       | **Core now** | Interaction picking is `WebGpuRenderer.pick` → `resolvePickTarget`. Node and element ids are strict product requirements; face is Core. Multi-hit `pickMany` is future (below), not Core-now.             |
| CPU raycast picking (`createPickScene` / `pick()`)                                                                                 | —                  | —          | **Remove**   | Replaced by the GPU pick path; deleted with the flat-compile cleanup.                                                                                                                                     |
| Adjacency inspection overlays / pick-list UI polish                                                                                | demo               | e2e        | **Deferred** | Host-mappable neighbor ids on `PickTarget` stay; rich adjacency workbench polish is optional.                                                                                                             |
| Results fields + derived quantities (magnitude, von Mises, principal), value ranges, scalar color mapping, deformed-shape geometry | ~0.8k              | ~0.9k      | **Core now** | Typed result visualization is core FE value.                                                                                                                                                              |
| Advanced results playback (CasePlayer, interpolation) and legends                                                                  | —                  | —          | **Remove**   | Deleted; core results keep fields, derived quantities, scalar color mapping, and deformed shape without playback or legend helpers.                                                                       |
| IO: VTK legacy read/write + shared validation and diagnostics                                                                      | ~1.0k              | ~0.9k      | **Core now** | One interchange format is the minimum; VTK legacy is the smallest faithful FE format.                                                                                                                     |
| IO: VTU, Gmsh, Abaqus adapters, cancellation/progress                                                                              | —                  | —          | **Remove**   | Deleted; product keeps a single VTK legacy interchange path.                                                                                                                                              |
| Large-model streaming (spatial partitioning, LOD, upload budgets, worker parsing, coordinate rebasing)                             | —                  | —          | **Remove**   | Deleted; in-memory models are the product path.                                                                                                                                                           |
| Deformation (per-vertex displacement)                                                                                              | renderer + results | renderer   | **Core now** | Part of results visualization.                                                                                                                                                                            |
| Package smoke tests, e2e coverage, benchmarks and budgets                                                                          | scripts            | test/bench | **Core now** | Engineering gate stays; the e2e contract becomes WebGPU-only.                                                                                                                                             |
| Compatibility reporting (capability tiers/matrix)                                                                                  | wiki               | —          | **Deferred** | Collapses to "modern WebGPU browser or typed unsupported"; no tier ladder.                                                                                                                                |

## Recommended smallest supported product

femgx 0.x renders finite-element models in a **modern WebGPU browser**. A model
is defined as reusable part geometry (Point, Line, Line3, Triangle, Quad,
Tet4, Tet10, Hex8, and Hex20) placed by hierarchical assemblies, compiled once
into a packed scene runtime, and drawn with instanced WebGPU draws batched by
part. The renderer provides GPU picking with host-mappable part/instance/
element/face/node ids (node and element strict; face Core), readable
depth-tested node annotations, selection/
highlight/hover, visibility, camera control, results fields with derived
quantities and scalar color mapping, and deformed-shape geometry. Interchange
is a single format (VTK legacy) with validation and diagnostics. Browsers without
a working WebGPU device receive a typed
unsupported result — never a second renderer.

Everything outside the "Core now" rows is **not** a requirement of the minimum
product.

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

## Future: multi-hit pick lists (`pickMany`)

Not Core-now. A later extension can expose unique targets under a screen region
via ID-buffer readback (preferred first shape for box-ish pick lists). Ordered
multi-hit along a ray (depth peeling / A-buffer) is a harder follow-on and must
pass the [[#decision-gate|decision gate]] separately. Do not grow a parallel
CPU pick-list path.

## Deletion tracking

Removals are implemented by their owning issues, not speculatively here:

- CPU fallback rendering (and the raycast-fallback picker) → **removed in #171**
  (Simplify the product around modern WebGPU requirements). Capability probing
  and device-loss recovery were reviewed there and **retained** as supported-path
  features of the WebGPU contract.
- Flat `compileScene` snapshot and CPU raycast stack (`createPickScene` /
  `pick()`) → **removed**; the product path is `createSceneRuntime` + GPU
  `renderer.pick`.
- Element families beyond the supported Point, Line, Line3, Triangle, Quad,
  Tet4, Tet10, Hex8, and Hex20 set remain outside the product and require an
  explicit decision before implementation.
- Results playback / legends, IO breadth beyond VTK, and large-model streaming
  → **removed** (explicit product cleanup).
