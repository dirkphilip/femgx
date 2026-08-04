import { decodePickId, PICK_TEXTURE_FORMAT } from "./pick-format";

/** Pick render targets reused across frames and resized on demand. */
export interface PickTargets {
  texture: GPUTexture | undefined;
  /** Second attachment holding the per-element pick id. */
  elementTexture: GPUTexture | undefined;
  depthTexture: GPUTexture | undefined;
  readonly readback: PickReadbackPool;
}

/** Readback buffers pooled across pick calls; one map at a time per buffer. */
export interface PickReadbackPool {
  readonly free: GPUBuffer[];
  readonly inFlight: Set<GPUBuffer>;
}

/** The pick ids decoded from both pick-pass attachments. */
export interface PickPixelResult {
  /** 1-based instance slot, `0` when no geometry was hit. */
  readonly instancePickId: number;
  /** 1-based element id, `0` when the hit triangle has no element. */
  readonly elementPickId: number;
}

/**
 * Byte stride reserved per pick attachment in a pooled readback buffer. The
 * instance pick id is copied to offset 0 and the element pick id to
 * `READBACK_BYTE_STRIDE`, so one mapAsync covers both.
 */
export const READBACK_BYTE_STRIDE = 256;

const READBACK_SIZE = READBACK_BYTE_STRIDE * 2;

/** Creates empty pick targets; they are populated before the first pick pass. */
export function createPickTargets(): PickTargets {
  return {
    texture: undefined,
    elementTexture: undefined,
    depthTexture: undefined,
    readback: { free: [], inFlight: new Set() },
  };
}

/** Maps a client-space point to a clamped device-pixel pick coordinate. */
export function pickPixelCoordinates(
  x: number,
  y: number,
  rect: Pick<DOMRect, "width" | "height">,
  canvasWidth: number,
  canvasHeight: number,
): { readonly x: number; readonly y: number } {
  const pixelX = Math.max(0, Math.min(canvasWidth - 1, Math.floor((x / rect.width) * canvasWidth)));
  const pixelY = Math.max(
    0,
    Math.min(canvasHeight - 1, Math.floor((y / rect.height) * canvasHeight)),
  );
  return { x: pixelX, y: pixelY };
}

/** Creates the pick render targets once, sized to the current canvas. */
export function ensurePickTargets(
  device: GPUDevice,
  pick: PickTargets,
  width: number,
  height: number,
  depthFormat: GPUTextureFormat,
): void {
  if (pick.texture !== undefined) return;
  pick.texture = device.createTexture({
    size: [width, height],
    format: PICK_TEXTURE_FORMAT,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  });
  pick.elementTexture = device.createTexture({
    size: [width, height],
    format: PICK_TEXTURE_FORMAT,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  });
  pick.depthTexture = device.createTexture({
    size: [width, height],
    format: depthFormat,
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });
}

/** Begins the pick render pass used for asynchronous picking. */
export function beginPickPass(encoder: GPUCommandEncoder, pick: PickTargets): GPURenderPassEncoder {
  const texture = pick.texture;
  const elementTexture = pick.elementTexture;
  const depthTexture = pick.depthTexture;
  if (texture === undefined || elementTexture === undefined || depthTexture === undefined) {
    throw new Error("WebGPU picking targets were not created");
  }
  return encoder.beginRenderPass({
    colorAttachments: [
      {
        view: texture.createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp: "clear",
        storeOp: "store",
      },
      {
        view: elementTexture.createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp: "clear",
        storeOp: "store",
      },
    ],
    depthStencilAttachment: {
      view: depthTexture.createView(),
      depthClearValue: 1,
      depthLoadOp: "clear",
      depthStoreOp: "store",
    },
  });
}

/** Copies the pick textures under the pointer and reads both pick ids. */
export async function readPickPixel(
  device: GPUDevice,
  canvas: HTMLCanvasElement,
  pick: PickTargets,
  x: number,
  y: number,
): Promise<PickPixelResult> {
  const texture = pick.texture;
  const elementTexture = pick.elementTexture;
  if (texture === undefined || elementTexture === undefined) {
    return { instancePickId: 0, elementPickId: 0 };
  }
  const pixel = pickPixelCoordinates(
    x,
    y,
    canvas.getBoundingClientRect(),
    canvas.width,
    canvas.height,
  );
  const buffer = acquireReadback(device, pick.readback);
  let mapped = false;
  try {
    const encoder = device.createCommandEncoder();
    encoder.copyTextureToBuffer(
      { texture, origin: { x: pixel.x, y: pixel.y } },
      { buffer, offset: 0, bytesPerRow: READBACK_BYTE_STRIDE },
      { width: 1, height: 1 },
    );
    encoder.copyTextureToBuffer(
      { texture: elementTexture, origin: { x: pixel.x, y: pixel.y } },
      { buffer, offset: READBACK_BYTE_STRIDE, bytesPerRow: READBACK_BYTE_STRIDE },
      { width: 1, height: 1 },
    );
    device.queue.submit([encoder.finish()]);
    await buffer.mapAsync(GPUMapMode.READ);
    mapped = true;
    const pixels = new Uint8Array(buffer.getMappedRange());
    const instancePickId = decodePickId(pixels);
    const elementPickId = decodePickId(pixels, READBACK_BYTE_STRIDE);
    buffer.unmap();
    mapped = false;
    return { instancePickId, elementPickId };
  } finally {
    if (mapped) buffer.unmap();
    releaseReadback(pick.readback, buffer);
  }
}

/** Clears the pick render targets, keeping the size-independent readback pool. */
export function resetPickTargets(pick: PickTargets): void {
  pick.texture?.destroy();
  pick.elementTexture?.destroy();
  pick.depthTexture?.destroy();
  pick.texture = undefined;
  pick.elementTexture = undefined;
  pick.depthTexture = undefined;
}

/** Destroys the pick render targets and pooled readback buffers. */
export function destroyPickTargets(pick: PickTargets): void {
  resetPickTargets(pick);
  for (const buffer of pick.readback.inFlight) buffer.destroy();
  for (const buffer of pick.readback.free) buffer.destroy();
  pick.readback.inFlight.clear();
  pick.readback.free.length = 0;
}

/** Returns an unmapped readback buffer from the pool, creating one if needed. */
function acquireReadback(device: GPUDevice, pool: PickReadbackPool): GPUBuffer {
  const buffer = pool.free.pop();
  const acquired = buffer ?? createReadback(device);
  pool.inFlight.add(acquired);
  return acquired;
}

/** Returns a readback buffer to the pool once its map is complete. */
function releaseReadback(pool: PickReadbackPool, buffer: GPUBuffer): void {
  pool.inFlight.delete(buffer);
  pool.free.push(buffer);
}

function createReadback(device: GPUDevice): GPUBuffer {
  return device.createBuffer({
    size: READBACK_SIZE,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
}
