# Source organization

Implementation and tests live in subsystem directories under `src/` and `test/`
so ownership boundaries are obvious and each module stays small and focused.
See the [[architecture/architecture-overview|Architecture overview]] and `AGENTS.md` for the
canonical description.

## Layout

- `src/math/` — matrix/vector math (`mat4`).
- `src/geometry/` — reusable part geometry and computed bounds.
- `src/elements/` — typed finite-element model: shape/topology definitions
  (`shapes.ts`), validated element construction (`element.ts`), oriented face
  extraction and classification (`faces.ts`), unique edge extraction
  (`edges.ts`), plus internal helpers (`keys.ts`, `indices.ts`); pure CPU-side
  data with no WebGPU coupling (see [[data/elements-topology|Element topology]]).
- `src/scene/` — authoritative CPU model: part/assembly/instance identities
  (`types.ts`), assemblies, and the scene builder.
- `src/scene-runtime/` — packed CPU-side scene runtime with delta-oriented
  visibility updates (`createSceneRuntime`).
- `src/camera/` — immutable orbit camera and projection math.
- `src/interaction/` — centralized highlight/selection/hover/override state.
- `src/results/` — typed engineering result fields (scalar/vector/tensor over
  nodes or elements), derived quantities (magnitude, von Mises, principal
  values), value ranges, scalar color mapping with thresholds, and
  deformed-shape geometry; pure CPU-side data (see [[data/results|Results]]).
- `src/picking/` — GPU pick-id resolution (`resolvePick` / `resolvePickTarget`).
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
  camera, renderer, controls, resize, interaction synchronization, and teardown.

`test/` mirrors `src/` one-to-one: each source module has its suite in the
matching subsystem directory.

## Conventions

- New domain code belongs in the owning subsystem directory. Treat 300
  implementation lines as a design-review threshold and 400 as the hard limit;
  split modules when that improves cohesion and ownership.
- The single public entry point is `src/index.ts`; anything it does not
  re-export is internal. Do not widen the public API by exporting internals from
  a new location.
- Prefer intra-subsystem imports; import across subsystems through `src/index.ts`
  or the owning module's exported surface, not another subsystem's internals.

Related: [[engineering/scaffold-decisions|Scaffold decisions]], [[engineering/quality-gate|Quality gate]].

[architecture/architecture-overview|Architecture overview]: architecture-overview.md
[data/elements-topology|Element topology]: ../data/elements-topology.md
[data/results|Results]: ../data/results.md
[engineering/quality-gate|Quality gate]: ../engineering/quality-gate.md
[engineering/scaffold-decisions|Scaffold decisions]: ../engineering/scaffold-decisions.md
[rendering/platform-support|Platform support]: ../rendering/platform-support.md
