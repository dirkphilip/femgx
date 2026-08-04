# Source organization

Implementation and tests live in subsystem directories under `src/` and `test/`
so ownership boundaries are obvious and each module stays small and focused.
See the [[architecture-overview|Architecture overview]] and `AGENTS.md` for the
canonical description.

## Layout

- `src/math/` — matrix/vector math (`mat4`).
- `src/geometry/` — reusable part geometry and computed bounds.
- `src/elements/` — typed finite-element model: shape/topology definitions
  (`shapes.ts`), validated element construction (`element.ts`), oriented face
  extraction and classification (`faces.ts`), unique edge extraction
  (`edges.ts`), plus internal helpers (`keys.ts`, `indices.ts`); pure CPU-side
  data with no WebGPU coupling (see [[elements-topology|Element topology]]).
- `src/scene/` — authoritative CPU model: part/assembly/instance identities
  (`types.ts`), assemblies, and the scene builder.
- `src/runtime/` — compile pipeline: flattening, frustum culling, per-part
  batching, and `compileScene`.
- `src/scene-runtime/` — packed CPU-side scene runtime with delta-oriented
  visibility updates (`createSceneRuntime`).
- `src/camera/` — immutable orbit camera and projection math.
- `src/interaction/` — centralized highlight/selection/hover/override state.
- `src/picking/` — CPU-side pick-id resolution.
- `src/renderer/` — WebGPU renderer split into focused modules:
  `gpu-renderer.ts` (thin orchestrator and public API),
  `gpu-pipelines.ts` (layouts/pipelines/camera resources),
  `gpu-draw.ts` (per-part geometry, slot-stable record buffers, draw-order
  buffers, draw submission),
  `gpu-pick.ts` (pick targets and readback), `gpu-shaders.ts` (WGSL strings),
  `gpu-support.ts` (shared GPU helpers), and `runtime-state.ts` (CPU bridge from
  packed runtime slots to part-local storage).

`test/` mirrors `src/` one-to-one: each source module has its suite in the
matching subsystem directory.

## Conventions

- New domain code belongs in the owning subsystem directory; keep modules at or
  below the 300-line limit and split oversized modules into focused,
  single-concern files.
- The single public entry point is `src/index.ts`; anything it does not
  re-export is internal. Do not widen the public API by exporting internals from
  a new location.
- Prefer intra-subsystem imports; import across subsystems through `src/index.ts`
  or the owning module's exported surface, not another subsystem's internals.

Related: [[scaffold-decisions|Scaffold decisions]], [[quality-gate|Quality gate]].
