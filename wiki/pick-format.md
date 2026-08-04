# Pick texture format

The WebGPU pick pass renders the per-instance pick id into a dedicated
`rgba8unorm` texture and reads one pixel back on pointer events. The format and
its byte packing live in `src/renderer/pick-format.ts`, with the packing
mirrored in the WGSL `packPickId` in `src/renderer/gpu-shaders.ts`.

## Why `rgba8unorm` instead of `r32uint`

The natural format for an integer id readback is `r32uint`. In one headless
SwiftShader environment that path returned corrupted values (float bit patterns
such as `0x3F800000`) for some instances even though the GPU instance buffers
were verified correct and a minimal `r32uint` pipeline rendered cleanly — a
software-rasterizer quirk rather than a renderer bug (see
[[performance-issues|Performance issues and risks]]).

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
- **Sync**: the WGSL packing in `gpu-shaders.ts` and `encodePickId`/`decodePickId`
  in `pick-format.ts` must stay byte-for-byte in sync (R = least significant
  byte, little-endian channel order).
- **Unorm conversion**: writing `byte / 255.0` to an 8-bit unorm attachment
  round-trips exactly (`round(byte / 255 * 255) === byte`) for the 0–255 range.

## Tests

- `test/renderer/pick-format.test.ts` covers encode/decode boundaries (id 0/1,
  per-byte boundaries, `MAX_PICK_ID`) and the little-endian channel order.
- The demo's WebGPU probe renders and requires a real pick hit before committing
  to the WebGPU renderer, so a browser that cannot round-trip the format degrades
  to the deterministic CPU fallback (see [[webgpu-e2e|WebGPU browser e2e lane]]).

Related: [[interactive-state|Interactive state]],
[[webgpu-e2e|WebGPU browser e2e lane]],
[[performance-issues|Performance issues and risks]].
