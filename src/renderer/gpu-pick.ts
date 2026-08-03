/** Integer pick textures reused across frames and resized on demand. */
export interface PickTargets {
  texture: GPUTexture | undefined;
  depthTexture: GPUTexture | undefined;
  readonly readback: PickReadbackPool;
}

/** Readback buffers pooled across pick calls; one map at a time per buffer. */
export interface PickReadbackPool {
  readonly free: GPUBuffer[];
  readonly inFlight: Set<GPUBuffer>;
}

const READBACK_SIZE = 256;

/** Creates empty pick targets; they are populated before the first pick pass. */
export function createPickTargets(): PickTargets {
  return {
    texture: undefined,
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
    format: "r32uint",
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  });
  pick.depthTexture = device.createTexture({
    size: [width, height],
    format: depthFormat,
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });
}

/** Begins the integer render pass used for asynchronous picking. */
export function beginPickPass(encoder: GPUCommandEncoder, pick: PickTargets): GPURenderPassEncoder {
  const texture = pick.texture;
  const depthTexture = pick.depthTexture;
  if (texture === undefined || depthTexture === undefined) {
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
    ],
    depthStencilAttachment: {
      view: depthTexture.createView(),
      depthClearValue: 1,
      depthLoadOp: "clear",
      depthStoreOp: "store",
    },
  });
}

/** Copies the pick texture pixel under the pointer and reads its pick id. */
export async function readPickPixel(
  device: GPUDevice,
  canvas: HTMLCanvasElement,
  pick: PickTargets,
  x: number,
  y: number,
): Promise<number> {
  const texture = pick.texture;
  if (texture === undefined) return 0;
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
      { buffer, bytesPerRow: READBACK_SIZE },
      { width: 1, height: 1 },
    );
    device.queue.submit([encoder.finish()]);
    await buffer.mapAsync(GPUMapMode.READ);
    mapped = true;
    const pickId = new Uint32Array(buffer.getMappedRange())[0] ?? 0;
    buffer.unmap();
    mapped = false;
    return pickId;
  } finally {
    if (mapped) buffer.unmap();
    releaseReadback(pick.readback, buffer);
  }
}

/** Destroys the pick render targets and pooled readback buffers. */
export function destroyPickTargets(pick: PickTargets): void {
  pick.texture?.destroy();
  pick.depthTexture?.destroy();
  pick.texture = undefined;
  pick.depthTexture = undefined;
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
