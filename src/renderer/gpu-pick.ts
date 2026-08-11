import type { PickGranularity, PickContext } from "../picking/pick";
import { resolvePickTarget } from "../picking/pick";
import { canvasCssToRenderPixel } from "../camera/coordinates";
import type { PickTarget } from "../picking/types";
import { decodePickId, PICK_TEXTURE_FORMAT } from "./pick-format";
import { WebGpuPickReadbackError } from "./gpu-pick-error";
import {
  bindPickDepth,
  destroyPickDepthReadback,
  encodePickDepthReadback,
  type PickDepthReadback,
} from "./gpu-pick-depth";
export { WebGpuPickReadbackError } from "./gpu-pick-error";

/** Pick render targets reused across frames and resized on demand. */
export interface PickTargets {
  texture: GPUTexture | undefined;
  /** Second attachment holding the per-element pick id. */
  elementTexture: GPUTexture | undefined;
  /** Third attachment holding the per-triangle face pick id. */
  faceTexture: GPUTexture | undefined;
  /** Fourth attachment holding the per-fragment node pick id. */
  nodeTexture: GPUTexture | undefined;
  depthTexture: GPUTexture | undefined;
  depthReadback: PickDepthReadback | undefined;
  readonly readback: PickReadbackPool;
}

/** Readback buffers pooled across pick calls; one map at a time per buffer. */
export interface PickReadbackPool {
  readonly free: GPUBuffer[];
  readonly inFlight: Set<GPUBuffer>;
}

/** The pick ids decoded from the pick-pass attachments. */
export interface PickPixelResult {
  /** 1-based instance slot, `0` when no geometry was hit. */
  readonly instancePickId: number;
  /** 1-based element id, `0` when the hit triangle has no element. */
  readonly elementPickId: number;
  /** 1-based face id, `0` when the hit triangle has no face. */
  readonly facePickId: number;
  /** 1-based node id, `0` when the hit fragment has no node. */
  readonly nodePickId: number;
  /** WebGPU NDC depth in `[0, 1]`; `1` when no geometry was hit. */
  readonly ndcDepth: number;
}

/**
 * Thrown when the asynchronous GPU pick readback fails after rendering already
 * succeeded. The browser renders WebGPU correctly; only the single-pixel
 * readback (copy + `mapAsync`) could not be completed. This is a pick-path
 * failure, not a missing-WebGPU condition, so callers must report it as
 * pick-readback and never mislabel the environment as CPU-only.
 */
/**
 * Byte stride reserved per pick attachment in a pooled readback buffer. The
 * instance pick id is copied to offset 0, the element pick id to
 * `READBACK_BYTE_STRIDE`, the face pick id to `READBACK_BYTE_STRIDE * 2`, and
 * the node pick id to `READBACK_BYTE_STRIDE * 3`, so one mapAsync covers all.
 */
export const READBACK_BYTE_STRIDE = 256;

const READBACK_SIZE = READBACK_BYTE_STRIDE * 5;

/** Creates empty pick targets; they are populated before the first pick pass. */
export function createPickTargets(depthReadback?: PickDepthReadback): PickTargets {
  return {
    texture: undefined,
    elementTexture: undefined,
    faceTexture: undefined,
    nodeTexture: undefined,
    depthTexture: undefined,
    depthReadback,
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
  return canvasCssToRenderPixel({ x, y }, rect, { width: canvasWidth, height: canvasHeight });
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
  if (pick.depthReadback === undefined) {
    throw new Error("WebGPU picking depth resources were not validated during setup");
  }
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
  pick.faceTexture = device.createTexture({
    size: [width, height],
    format: PICK_TEXTURE_FORMAT,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  });
  pick.nodeTexture = device.createTexture({
    size: [width, height],
    format: PICK_TEXTURE_FORMAT,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  });
  pick.depthTexture = device.createTexture({
    size: [width, height],
    format: depthFormat,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  });
  bindPickDepth(device, pick.depthReadback, pick.depthTexture);
}

/** Copies the pick textures under the pointer and reads both pick ids. */
export async function readPickPixel(
  device: GPUDevice,
  canvas: HTMLCanvasElement,
  pick: PickTargets,
  x: number,
  y: number,
): Promise<PickPixelResult> {
  const textures = readableTextures(pick);
  if (textures === undefined) {
    return {
      instancePickId: 0,
      elementPickId: 0,
      facePickId: 0,
      nodePickId: 0,
      ndcDepth: 1,
    };
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
    submitPickCopies(device, textures, buffer, pixel);
    await buffer.mapAsync(GPUMapMode.READ);
    mapped = true;
    const result = decodePickPixel(new Uint8Array(buffer.getMappedRange()));
    buffer.unmap();
    mapped = false;
    return result;
  } catch (error) {
    // Rendering already succeeded; only the pick readback failed (e.g. the
    // mapAsync rejection seen on some iOS/WebKit builds). Surface it as a
    // precise pick-path failure instead of a generic unsupported/CPU-only
    // error so callers can classify the phase independently.
    throw new WebGpuPickReadbackError(
      "WebGPU pick readback failed: rendering works, but the pick pixels could not be read back",
      { cause: error },
    );
  } finally {
    if (mapped) buffer.unmap();
    releaseReadback(pick.readback, buffer);
  }
}

interface ReadablePickTextures {
  readonly instance: GPUTexture;
  readonly element: GPUTexture;
  readonly face: GPUTexture;
  readonly node: GPUTexture;
  readonly readback: PickDepthReadback;
}

function readableTextures(pick: PickTargets): ReadablePickTextures | undefined {
  const { texture, elementTexture, faceTexture, nodeTexture, depthTexture, depthReadback } = pick;
  if (
    texture === undefined ||
    elementTexture === undefined ||
    faceTexture === undefined ||
    nodeTexture === undefined ||
    depthTexture === undefined ||
    depthReadback === undefined
  ) {
    return undefined;
  }
  return {
    instance: texture,
    element: elementTexture,
    face: faceTexture,
    node: nodeTexture,
    readback: depthReadback,
  };
}

function submitPickCopies(
  device: GPUDevice,
  textures: ReadablePickTextures,
  buffer: GPUBuffer,
  pixel: { readonly x: number; readonly y: number },
): void {
  const encoder = device.createCommandEncoder();
  const ordered = [textures.instance, textures.element, textures.face, textures.node];
  ordered.forEach((texture, index) => {
    copyPickPixel(encoder, buffer, pixel, { texture, offset: READBACK_BYTE_STRIDE * index });
  });
  encodePickDepthReadback(device, encoder, textures.readback, buffer, pixel);
  device.queue.submit([encoder.finish()]);
}

/** Copies one pick attachment under the pointer into the readback buffer. */
function copyPickPixel(
  encoder: GPUCommandEncoder,
  buffer: GPUBuffer,
  pixel: { readonly x: number; readonly y: number },
  attachment: { readonly texture: GPUTexture; readonly offset: number },
): void {
  encoder.copyTextureToBuffer(
    { texture: attachment.texture, origin: { x: pixel.x, y: pixel.y } },
    { buffer, offset: attachment.offset, bytesPerRow: READBACK_BYTE_STRIDE },
    { width: 1, height: 1 },
  );
}

/** Decodes the four pick ids from a mapped readback buffer. */
function decodePickPixel(pixels: Uint8Array): PickPixelResult {
  return {
    instancePickId: decodePickId(pixels),
    elementPickId: decodePickId(pixels, READBACK_BYTE_STRIDE),
    facePickId: decodePickId(pixels, READBACK_BYTE_STRIDE * 2),
    nodePickId: decodePickId(pixels, READBACK_BYTE_STRIDE * 3),
    ndcDepth: new DataView(
      pixels.buffer,
      pixels.byteOffset + READBACK_BYTE_STRIDE * 4,
      4,
    ).getFloat32(0, true),
  };
}

/** Inputs for resolving a pixel to a pick target. */
export interface PickTargetFromPixelOptions {
  readonly device: GPUDevice;
  readonly canvas: HTMLCanvasElement;
  readonly pick: PickTargets;
  readonly context: PickContext;
  readonly x: number;
  readonly y: number;
  readonly granularity?: PickGranularity | undefined;
}

/**
 * Reads the four pick ids under a pixel and resolves them to a pick target.
 * `undefined` when nothing was hit.
 */
export async function pickTargetFromPixel(
  options: PickTargetFromPixelOptions,
): Promise<PickTarget | undefined> {
  const { device, canvas, pick, context, x, y, granularity } = options;
  const ids = await readPickPixel(device, canvas, pick, x, y);
  return resolvePickTarget(context, ids, granularity);
}

/** Clears the pick render targets, keeping the size-independent readback pool. */
export function resetPickTargets(pick: PickTargets): void {
  pick.texture?.destroy();
  pick.elementTexture?.destroy();
  pick.faceTexture?.destroy();
  pick.nodeTexture?.destroy();
  pick.depthTexture?.destroy();
  pick.texture = undefined;
  pick.elementTexture = undefined;
  pick.faceTexture = undefined;
  pick.nodeTexture = undefined;
  pick.depthTexture = undefined;
  if (pick.depthReadback !== undefined) pick.depthReadback.bindGroup = undefined;
}

/** Destroys the pick render targets and pooled readback buffers. */
export function destroyPickTargets(pick: PickTargets): void {
  resetPickTargets(pick);
  if (pick.depthReadback !== undefined) destroyPickDepthReadback(pick.depthReadback);
  pick.depthReadback = undefined;
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
