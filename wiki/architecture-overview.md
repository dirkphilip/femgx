# Architecture overview

The library separates a CPU-side scene model from a future GPU renderer. The
scene is authoritative; the renderer syncs deltas from it.

## Layers

- `src/scene/scene.ts` — authoritative CPU model: parts, assemblies, and
  visibility. Immutable builder API (`createScene`); every update returns a new
  builder so state changes are deltas, not scattered mutations.
- `src/runtime/flatten.ts` — iteratively flattens an assembly tree into a
  deterministic, depth-first instance list. Hidden assemblies/parts are culled
  at the source, so hidden geometry is never drawn; compact draw indices are
  separate from stable placement `instanceId` handles.
- `src/runtime/compile.ts` and `src/runtime/batch.ts` — compile visible
  instances and group them into deterministic reusable-part batches for
  renderer submission.
- `src/scene-runtime/runtime.ts` — packed scene runtime: `createSceneRuntime(scene)`
  compiles the scene into typed arrays with delta-oriented visibility updates
  (see [[packed-runtime|Packed scene runtime]]).
- `src/runtime/culling.ts` — extracts frustum planes and culls transformed part
  bounds before batching while preserving stable placement handles.
- `src/interaction/interaction.ts` — immutable centralized selection, highlight,
  hover, and style override state with explicit precedence.
- `src/camera/camera.ts` — immutable orbit camera math for perspective and
  orthographic projection, shared by the demo and future renderers.
- `src/renderer/gpu-renderer.ts` — WebGPU lifecycle, one-time part uploads,
  slot-stable instance attributes, GPU subrange updates for packed deltas
  (see [[renderer-subrange-updates|Renderer subrange updates]]), depth-tested
  instanced draws, and asynchronous pick readback.
- `src/geometry/part.ts` — part geometry + computed bounds. Parts are immutable
  and own no transforms.
- `src/math/mat4.ts` — column-major 4x4 math
  (identity/translation/scale/rotation/multiply).
- `src/picking/pick.ts` — CPU-side pick-id resolution (`resolvePick`,
  `instanceToTarget`) used after the renderer's GPU readback.

## Renderer

The renderer owns the WebGPU device, canvas configuration, pipelines, depth and
pick textures, geometry buffers, and per-instance storage buffers. It is isolated
behind a small interface and tested with a mocked device; see
[[interactive-state|Interactive state]] for the GPU attribute design.

## Ownership boundaries

- Parts own geometry; immutable once uploaded.
- Assemblies own placement/hierarchy.
- The renderer owns device/swapchain/pipelines.

Related: [[instancing-strategy|Instancing strategy]].
