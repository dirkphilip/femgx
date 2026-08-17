# Pick texture format

WebGPU picking rasterizes geometry once. The pass renders instance, element,
face, and node ids into four dedicated `rgba8unorm` textures and stores the
winning fragment in its normal depth attachment. Readback copies the four ID
pixels and uses a one-invocation compute pass to load the requested depth texel
into the same pooled readback buffer. One `mapAsync` then yields all four ids
plus depth; `PickHit.worldPosition` unprojects that depth into the displayed world position.
ID packing lives in `src/renderer/pick-format.ts`, with the packing mirrored in
WGSL `packPickId`. The public `PickHit.worldPosition` is reconstructed from this
same one-readback depth value; there is no separate public point-picking call.

`Viewport.pickRegion` copies only the requested ID attachments. Each
attachment uses a 256-byte-aligned row stride, and large rectangles are split
into internal row tiles under a bounded byte budget. Pixels are deduplicated as
compact ID tuples before rich target resolution; depth is not copied because
the pick pass already retains the nearest visible rasterized sample. This is
visible-intersection discovery, not ordered multi-hit or click-through picking.

Depth remains in the pick pass's normal depth attachment and is copied through
a one-invocation compute pass. Sampling that existing attachment avoids a
redundant color target and keeps ids plus exact winning-fragment depth in one
geometry pass. The visible color pass is submitted independently before the
pick pass, so a pick-path validation failure cannot invalidate the displayed
frame.

## Why `rgba8unorm` instead of `r32uint`

The natural format for an integer id readback is `r32uint`. In one headless
SwiftShader environment that path returned corrupted values (float bit patterns
such as `0x3F800000`) for some instances even though the GPU instance buffers
were verified correct and a minimal `r32uint` pipeline rendered cleanly — a
software-rasterizer quirk rather than a renderer bug.

The pick id is therefore packed across the four 8-bit channels of an
`rgba8unorm` texture instead. Every WebGPU implementation supports `rgba8unorm`
render targets and byte-typed readback, so the format round-trips the full
supported pick-id range without a backend-specific integer-texture quirk.

## Trade-offs

- **Reliability over exactness**: `rgba8unorm` readback is byte-based and
  universally reliable, at the cost of a small pack-in-shader / decode-in-CPU
  step that `r32uint` did not need.
- **Supported range**: pick ids occupy the full 32-bit range `[1, 2^32 - 1]`;
  id `0` (the texture clear value) means "no hit". `MAX_PICK_ID` documents the
  upper bound, far beyond any practical instance count.
- **Sync**: the WGSL packing in `renderer/shaders/scene.ts` and `encodePickId`/`decodePickId`
  in `pick-format.ts` must stay byte-for-byte in sync (R = least significant
  byte, little-endian channel order).
- **Unorm conversion**: writing `byte / 255.0` to an 8-bit unorm attachment
  round-trips exactly (`round(byte / 255 * 255) === byte`) for the 0–255 range.

## Tests

- `test/renderer/picking/pick-format.test.ts` covers encode/decode boundaries (id 0/1,
  per-byte boundaries, `MAX_PICK_ID`) and the little-endian channel order.
- The e2e lane renders and picks through the real WebGPU renderer. A failed pick
  sweep fails the required hardware lane; it is not treated as a capability
  skip (see [[rendering/webgpu-e2e|WebGPU browser e2e lane]]).

Related: [[rendering/interactive-state|Interactive state]],
[[rendering/webgpu-e2e|WebGPU browser e2e lane]].

[rendering/interactive-state|Interactive state]: interactive-state.md
[rendering/webgpu-e2e|WebGPU browser e2e lane]: webgpu-e2e.md
