/**
 * Pick render-target format: `rgba8unorm` with the pick id packed across all
 * four 8-bit channels. This deliberately avoids `r32uint`, whose integer
 * readback can be corrupted by SwiftShader's software rasterizer; the byte
 * form round-trips the full supported pick-id range on every WebGPU
 * implementation. See `wiki/pick-format.md` for the trade-off.
 */
export const PICK_TEXTURE_FORMAT = "rgba8unorm" as GPUTextureFormat;

/** Largest supported pick id (`2^32 - 1`); pick id `0` means "no hit". */
export const MAX_PICK_ID = 0xffff_ffff;

/**
 * Encodes a pick id into the four RGBA bytes written to the pick texture,
 * mirroring the `packPickId` WGSL function in `shaders/scene.ts`. Channel order
 * is little-endian (R = least significant byte); keep both in sync.
 */
export function encodePickId(pickId: number): Uint8Array {
  const id = pickId >>> 0;
  return new Uint8Array([id & 0xff, (id >>> 8) & 0xff, (id >>> 16) & 0xff, (id >>> 24) & 0xff]);
}

/** Decodes a pick id packed into the first bytes of an `rgba8unorm` pixel. */
export function decodePickId(pixel: ArrayLike<number>, offset = 0): number {
  return (
    ((pixel[offset] ?? 0) |
      ((pixel[offset + 1] ?? 0) << 8) |
      ((pixel[offset + 2] ?? 0) << 16) |
      ((pixel[offset + 3] ?? 0) << 24)) >>>
    0
  );
}
