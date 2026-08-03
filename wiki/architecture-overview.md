# Architecture overview

The library separates a CPU-side scene model from a future GPU renderer. The
scene is authoritative; the renderer syncs deltas from it.

## Layers

- `src/scene.ts` — authoritative CPU model: parts, assemblies, and visibility.
  Immutable builder API (`createScene`); every update returns a new builder so
  state changes are deltas, not scattered mutations.
- `src/flatten.ts` — flattens an assembly tree into a deterministic, depth-first
  instance list. Hidden assemblies/parts are culled at the source, so hidden
  geometry is never drawn and instance indices stay stable frame-to-frame.
- `src/part.ts` — part geometry + computed bounds. Parts are immutable and own
  no transforms.
- `src/mat4.ts` — minimal column-major 4x4 math (identity/translation/multiply).
- `src/pick.ts` — CPU-side pick-id resolution (`resolvePick`,
  `instanceToTarget`). The GPU readback that produces the pick id is a renderer
  concern (not yet implemented).

## Renderer (future)

The renderer will own the WebGPU device, swapchain, pipelines, and per-instance
GPU buffers. It must sit behind a thin interface so it can be mocked in tests;
see [[interactive-state|Interactive state]] for the GPU attribute design.

## Ownership boundaries

- Parts own geometry; immutable once uploaded.
- Assemblies own placement/hierarchy.
- The renderer owns device/swapchain/pipelines.

Related: [[instancing-strategy|Instancing strategy]].
