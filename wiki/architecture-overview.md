# Architecture overview

The library separates a CPU-side scene model from a future GPU renderer. The
scene is authoritative; the renderer syncs deltas from it.

## Layers

- `src/scene.ts` — authoritative CPU model: parts, assemblies, and visibility.
  Immutable builder API (`createScene`); every update returns a new builder so
  state changes are deltas, not scattered mutations.
- `src/flatten.ts` — iteratively flattens an assembly tree into a deterministic,
  depth-first instance list. Hidden assemblies/parts are culled at the source, so
  hidden geometry is never drawn; compact draw indices are separate from stable
  placement `instanceId` handles.
- `src/runtime.ts` and `src/batch.ts` — compile visible instances and group them
  into deterministic reusable-part batches for renderer submission.
- `src/culling.ts` — extracts frustum planes and culls transformed part bounds
  before batching while preserving stable placement handles.
- `src/interaction.ts` — immutable centralized selection, highlight, hover, and
  style override state with explicit precedence.
- `src/camera.ts` — immutable orbit camera math for perspective and orthographic
  projection, shared by the demo and future renderers.
- `src/gpu-renderer.ts` — WebGPU lifecycle, one-time part uploads, storage-backed
  instance attributes, depth-tested instanced draws, and asynchronous pick readback.
- `src/part.ts` — part geometry + computed bounds. Parts are immutable and own
  no transforms.
- `src/mat4.ts` — column-major 4x4 math (identity/translation/scale/rotation/multiply).
- `src/pick.ts` — CPU-side pick-id resolution (`resolvePick`,
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
