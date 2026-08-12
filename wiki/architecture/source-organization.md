# Source organization

Implementation and tests live in subsystem directories under `src/` and `test/`
so ownership boundaries are obvious and each module stays small and focused.
See the [[architecture/architecture-overview|Architecture overview]] and `AGENTS.md` for the
canonical description.

## Layout

- `src/math/` — foundational matrix/vector math (`mat4`, `vec3`). `Vec3` and
  general vector operations live here so geometry, camera, picking, and scene
  share one owner.
- `src/geometry/` — reusable part geometry, the `PartId` identity, and computed
  bounds; it depends on math and elements, never on scene.
- `src/elements/` — typed finite-element model: shape/topology definitions
  (`shapes.ts`), validated element construction (`element.ts`), oriented face
  extraction and classification (`faces.ts`), unique edge extraction
  (`edges.ts`), plus internal helpers (`keys.ts`, `indices.ts`); pure CPU-side
  data with no WebGPU coupling (see [[data/elements-topology|Element topology]]).
- `src/scene/` — authoritative CPU model: assembly/instance identities
  (`types.ts`), assemblies, and the scene builder. `PartId` remains owned by
  geometry because it identifies reusable geometry.
- `src/scene-runtime/` — packed CPU-side scene runtime with delta-oriented
  visibility updates (`createSceneRuntime`).
- `src/camera/` — immutable orbit camera and projection math.
- `src/interaction/` — centralized highlight/selection/hover/override state.
- `src/results/` — typed engineering result fields (scalar/vector/tensor over
  nodes or elements), derived quantities (magnitude, von Mises, principal
  values), value ranges, scalar color mapping with thresholds, and
  deformed-shape geometry. It owns the CPU-side `DeformationState` contract
  consumed by the viewport and renderer (see [[data/results|Results]]).
- `src/picking/` — complete GPU hit reporting and pure interaction-target conversion
  and renderer-independent pick target types. It may depend on scene,
  geometry, elements, and math.
- `src/platform/` — explicit WebGPU unsupported/error reporting with typed reasons (`capabilities.ts`), plus device request, loss reporting, and re-creation focused on the supported path (`device.ts`); see [[rendering/platform-support|Platform support]].
- `src/renderer/` — WebGPU renderer split into focused modules:
  `gpu-renderer.ts` (thin orchestrator and public API),
  `gpu-pipelines.ts` (layouts/pipelines/camera resources),
  `gpu-draw.ts` (per-part geometry, slot-stable record buffers, draw-order
  buffers, draw submission),
  `gpu-pick.ts` (pick targets and readback), `gpu-shaders.ts` (WGSL strings),
  `gpu-support.ts` (shared GPU helpers), `gpu-recovery.ts` (device-loss tracking
  and resource re-creation), and `runtime-state.ts` (CPU bridge from packed
  runtime slots to part-local storage).
- `src/viewport/` — canonical host-facing ownership of scene runtime, fitted
  camera, renderer, controls, resize, interaction synchronization, the pure
  `changedInstanceSlots` orchestration helper, and teardown.

`test/` mirrors `src/` for product subsystem ownership, with deliberate
repository-level suites under `test/demo`, `test/public-api`, `test/runtime`,
`test/scripts`, and `test/supervisor`.

## Conventions

- New domain code belongs in the owning subsystem directory. Treat 300
  implementation lines as a design-review threshold and 400 as the hard limit;
  split modules when that improves cohesion and ownership.
- The single public entry point is `src/index.ts`; anything it does not
  re-export is internal. Do not widen the public API by exporting internals from
  a new location.
- Prefer intra-subsystem imports. External consumers use `src/index.ts` through
  the package; production modules under `src/` never import `src/index.ts`.
  Cross-subsystem imports use a deliberate owner module such as
  `geometry/part.ts`, `renderer/gpu-renderer.ts`, or `results/deform.ts`, not
  another subsystem's implementation internals. A boundary module may
  re-export an owned helper without adding it to the package root. Type-only
  imports count as dependencies just like runtime imports.
- The mandatory dependency-cruiser gate encodes this direction as a subsystem
  matrix. A new matrix edge is an architecture decision: it must provide
  concrete product value and be documented at the owning boundary.
- The intended lower-level direction is `math` → nothing, `geometry` → math and
  elements, `scene` → geometry/elements/math, `interaction` → camera/math and
  its domain owners, and `picking` → scene, geometry/elements/math. Any cycle
  or upward edge is an ownership problem to fix at the source, not an import
  exception to hide.

## Deliberate boundaries

- `geometry/part.ts` owns the `Part` data contract and re-exports the geometry
  validation queries used by renderer code; `part-validation.ts` remains an
  implementation module.
- `results/deform.ts` owns the plain CPU `DeformationState`; GPU buffers and
  synchronization remain private to `renderer/gpu-deform.ts`.
- `renderer/gpu-renderer.ts` is the viewport's renderer boundary. The viewport
  does not import renderer implementation modules.
- The renderer may depend on shared `math` types such as `Vec3` in its public
  and internal signatures; this is a deliberate type-level downward edge, not
  a second math or renderer abstraction.
- `viewport/interaction-diff.ts` owns `changedInstanceSlots` because it is a
  pure orchestration helper used only while the viewport synchronizes state.

Related: [[engineering/scaffold-decisions|Scaffold decisions]], [[engineering/quality-gate|Quality gate]].

[architecture/architecture-overview|Architecture overview]: architecture-overview.md
[data/elements-topology|Element topology]: ../data/elements-topology.md
[data/results|Results]: ../data/results.md
[engineering/quality-gate|Quality gate]: ../engineering/quality-gate.md
[engineering/scaffold-decisions|Scaffold decisions]: ../engineering/scaffold-decisions.md
[rendering/platform-support|Platform support]: ../rendering/platform-support.md
