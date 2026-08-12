# Architecture overview

The library separates a CPU-side scene model from a future GPU renderer. The
scene is authoritative; the renderer syncs deltas from it.

## Layers

- `src/scene/scene.ts` — authoritative CPU model: parts, assemblies, and
  visibility. Immutable builder API (`createScene`); every update returns a new
  builder so state changes are deltas, not scattered mutations.
- `src/scene-runtime/` — the single scene compiler and runtime boundary:
  `createSceneRuntime(scene)` exposes stable handles while the internal packed
  compiler performs the iterative, deterministic depth-first compile into
  typed arrays with delta-oriented visibility updates (see
  [[architecture/packed-runtime|Packed scene runtime]]).
- `src/interaction/interaction.ts` and `src/interaction/state.ts` — opaque
  immutable centralized target selection, highlight, single-hover, and style
  override state with explicit precedence.
- `src/camera/camera.ts` — immutable orbit camera math for perspective and
  orthographic projection, shared by the demo and future renderers.
- `src/renderer/gpu-renderer.ts` — WebGPU lifecycle, one-time part uploads,
  slot-stable instance attributes, GPU subrange updates for packed deltas
  (see [[rendering/renderer-subrange-updates|Renderer subrange updates]]), depth-tested
  instanced draws, and asynchronous pick readback.
- `src/geometry/part.ts` — part geometry + computed bounds. Parts are immutable
  and own no transforms.
- `src/elements/` — typed finite-element model: shape/topology definitions and a
  validated `createElement` constructor, independent of the renderer
  (see [[data/elements-topology|Element topology]]).
- `src/math/mat4.ts` — column-major 4x4 math
  (identity/translation/scale/rotation/multiply).
- `src/picking/pick.ts` — CPU-side pick-id resolution (`resolvePick`,
  `instanceToTarget`) used after the renderer's GPU readback.

## Renderer

The renderer owns the WebGPU device, canvas configuration, pipelines, depth and
pick textures, geometry buffers, and per-instance storage buffers. It is isolated
behind a small interface and tested with a mocked device; see
[[rendering/interactive-state|Interactive state]] for the GPU attribute design.

## Ownership boundaries

- Parts own geometry; immutable once uploaded.
- Assemblies own placement/hierarchy.
- The renderer owns device/swapchain/pipelines.

Related: [[architecture/instancing-strategy|Instancing strategy]].

[architecture/instancing-strategy|Instancing strategy]: instancing-strategy.md
[architecture/packed-runtime|Packed scene runtime]: packed-runtime.md
[data/elements-topology|Element topology]: ../data/elements-topology.md
[rendering/interactive-state|Interactive state]: ../rendering/interactive-state.md
[rendering/renderer-subrange-updates|Renderer subrange updates]: ../rendering/renderer-subrange-updates.md
