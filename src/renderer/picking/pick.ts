import type { PickContext } from "../../picking/pick";
import { resolvePickHit } from "../../picking/pick";
import { canvasCssToRenderPixel } from "../../camera/coordinates";
import { unprojectPoint, type Camera } from "../../camera/camera";
import type { PickHit } from "../../picking/types";
import type { Vec3 } from "../../math/vec3";
import { decodePickId, PICK_TEXTURE_FORMAT } from "./pick-format";
import { WebGpuPickReadbackError } from "./error";
import {
  acquirePickDepthReadback,
  bindPickDepth,
  destroyPickDepthReadback,
  encodePickDepthReadback,
  type PickDepthReadback,
} from "./depth";
export { WebGpuPickReadbackError } from "./error";

/** Pick render targets reused across frames and resized on demand. */
export interface PickTargets {
  texture: GPUTexture | undefined;
  /** Second attachment holding the per-element pick id. */
  elementTexture: GPUTexture | undefined;
  /** Third attachment holding the per-triangle face pick id. */
  faceTexture: GPUTexture | undefined;
  /** Fourth attachment holding the per-fragment node pick id. */
  nodeTexture: GPUTexture | undefined;
  /** Lazy fifth target written only by authored-edge picking. */
  edgeTexture: GPUTexture | undefined;
  depthTexture: GPUTexture | undefined;
  depthReadback: PickDepthReadback | undefined;
  readonly readback: PickReadbackPool;
}

/** Readback buffers pooled across pick calls; one map at a time per buffer. */
export interface PickReadbackPool {
  readonly free: PickReadbackBuffer[];
  readonly inFlight: Set<GPUBuffer>;
  readonly capacities: Map<GPUBuffer, number>;
  closed: boolean;
}

interface PickReadbackBuffer {
  readonly buffer: GPUBuffer;
  readonly size: number;
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
 * Byte stride reserved per pick attachment in a pooled readback buffer. The
 * instance pick id is copied to offset 0, the element pick id to
 * `READBACK_BYTE_STRIDE`, the face pick id to `READBACK_BYTE_STRIDE * 2`, and
 * the node pick id to `READBACK_BYTE_STRIDE * 3`, so one mapAsync covers all.
 */
export const READBACK_BYTE_STRIDE = 256;

const READBACK_SIZE = READBACK_BYTE_STRIDE * 5;
const EDGE_READBACK_SIZE = READBACK_BYTE_STRIDE * 6;

export type EdgePickPixelResult = { readonly ids: PickPixelResult; readonly edgePickId: number };

/** Creates empty pick targets; they are populated before the first pick pass. */
export function createPickTargets(depthReadback?: PickDepthReadback): PickTargets {
  return {
    texture: undefined,
    elementTexture: undefined,
    faceTexture: undefined,
    nodeTexture: undefined,
    edgeTexture: undefined,
    depthTexture: undefined,
    depthReadback,
    readback: { free: [], inFlight: new Set(), capacities: new Map(), closed: false },
  };
}

/** Creates the optional authored-edge target after the ordinary pick targets exist. */
export function ensureEdgePickTarget(
  device: GPUDevice,
  pick: PickTargets,
  width: number,
  height: number,
): void {
  if (pick.edgeTexture !== undefined) return;
  if (pick.depthTexture === undefined) {
    throw new Error("Authored-edge picking requires ordinary pick depth resources");
  }
  pick.edgeTexture = device.createTexture({
    label: "femgx authored edge pick texture",
    size: [width, height],
    format: PICK_TEXTURE_FORMAT,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  });
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
    label: "femgx instance pick texture",
    size: [width, height],
    format: PICK_TEXTURE_FORMAT,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  });
  pick.elementTexture = device.createTexture({
    label: "femgx element pick texture",
    size: [width, height],
    format: PICK_TEXTURE_FORMAT,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  });
  pick.faceTexture = device.createTexture({
    label: "femgx face pick texture",
    size: [width, height],
    format: PICK_TEXTURE_FORMAT,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  });
  pick.nodeTexture = device.createTexture({
    label: "femgx node pick texture",
    size: [width, height],
    format: PICK_TEXTURE_FORMAT,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  });
  pick.depthTexture = device.createTexture({
    label: "femgx pick depth texture",
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
  return (await readPickPixelResult({ device, canvas, pick, x, y, edge: undefined })).ids;
}

/** Reads ordinary and lazy edge ids in one map; ordinary picks retain five slots. */
export async function readEdgePickPixel(
  device: GPUDevice,
  canvas: HTMLCanvasElement,
  pick: PickTargets,
  x: number,
  y: number,
): Promise<EdgePickPixelResult> {
  return readPickPixelResult({ device, canvas, pick, x, y, edge: pick.edgeTexture });
}

interface PickPixelReadOptions {
  readonly device: GPUDevice;
  readonly canvas: HTMLCanvasElement;
  readonly pick: PickTargets;
  readonly x: number;
  readonly y: number;
  readonly edge: GPUTexture | undefined;
}

async function readPickPixelResult(options: PickPixelReadOptions): Promise<EdgePickPixelResult> {
  const { pick } = options;
  const initialTextures = readableTextures(pick);
  if (initialTextures === undefined) return { ids: emptyPickPixel(), edgePickId: 0 };
  const depthReadback = initialTextures.readback;
  let releaseDepth: (() => void) | undefined;
  try {
    const acquiredDepth = acquirePickDepthReadback(depthReadback);
    releaseDepth = acquiredDepth instanceof Promise ? await acquiredDepth : acquiredDepth;
    if (releaseDepth === undefined) {
      throw new Error("WebGPU picking depth resources were destroyed");
    }
    return await readLockedPickPixel(options, depthReadback);
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
    releaseDepth?.();
  }
}

async function readLockedPickPixel(
  options: PickPixelReadOptions,
  depthReadback: PickDepthReadback,
): Promise<EdgePickPixelResult> {
  const { device, canvas, pick, x, y, edge } = options;
  // The depth lock may suspend across a resize; refresh the snapshot before
  // encoding so a queued pick never submits copies from destroyed targets.
  const textures = readableTextures(pick);
  if (
    textures === undefined ||
    textures.readback !== depthReadback ||
    (edge !== undefined && pick.edgeTexture !== edge)
  ) {
    throw new Error("WebGPU picking targets were resized while waiting for depth resources");
  }
  const pixel = pickPixelCoordinates(
    x,
    y,
    canvas.getBoundingClientRect(),
    canvas.width,
    canvas.height,
  );
  const readbackSize = edge === undefined ? READBACK_SIZE : EDGE_READBACK_SIZE;
  const buffer = acquirePickReadback(device, pick.readback, readbackSize);
  let mapped = false;
  try {
    submitPickCopies(device, textures, buffer, pixel, edge);
    await buffer.mapAsync(GPUMapMode.READ);
    mapped = true;
    return decodePickPixel(new Uint8Array(buffer.getMappedRange()), edge !== undefined);
  } finally {
    if (mapped) buffer.unmap();
    releasePickReadback(pick.readback, buffer, readbackSize);
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
  edge: GPUTexture | undefined,
): void {
  const encoder = device.createCommandEncoder({ label: "femgx pick region copy" });
  const ordered = [textures.instance, textures.element, textures.face, textures.node];
  ordered.forEach((texture, index) => {
    copyPickPixel(encoder, buffer, pixel, { texture, offset: READBACK_BYTE_STRIDE * index });
  });
  const depthOffset = edge === undefined ? READBACK_BYTE_STRIDE * 4 : READBACK_BYTE_STRIDE * 5;
  if (edge !== undefined) {
    copyPickPixel(encoder, buffer, pixel, { texture: edge, offset: READBACK_BYTE_STRIDE * 4 });
  }
  encodePickDepthReadback(
    device,
    encoder,
    textures.readback,
    { buffer, offset: depthOffset },
    pixel,
  );
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

/** Decodes one mapped ordinary or authored-edge pick readback. */
function decodePickPixel(pixels: Uint8Array, hasEdge: boolean): EdgePickPixelResult {
  const depthOffset = READBACK_BYTE_STRIDE * (hasEdge ? 5 : 4);
  return {
    ids: {
      instancePickId: decodePickId(pixels),
      elementPickId: decodePickId(pixels, READBACK_BYTE_STRIDE),
      facePickId: decodePickId(pixels, READBACK_BYTE_STRIDE * 2),
      nodePickId: decodePickId(pixels, READBACK_BYTE_STRIDE * 3),
      ndcDepth: new DataView(pixels.buffer, pixels.byteOffset + depthOffset, 4).getFloat32(0, true),
    },
    edgePickId: hasEdge ? decodePickId(pixels, READBACK_BYTE_STRIDE * 4) : 0,
  };
}

function emptyPickPixel(): PickPixelResult {
  return { instancePickId: 0, elementPickId: 0, facePickId: 0, nodePickId: 0, ndcDepth: 1 };
}

/** Inputs for resolving a pixel to a pick target. */
export interface PickHitFromPixelOptions {
  readonly device: GPUDevice;
  readonly canvas: HTMLCanvasElement;
  readonly pick: PickTargets;
  readonly context: PickContext;
  readonly camera: Camera;
  readonly x: number;
  readonly y: number;
}

/**
 * Reads the four pick ids under a pixel and resolves them to a pick target.
 * `undefined` when nothing was hit.
 */
export async function pickHitFromPixel(
  options: PickHitFromPixelOptions,
): Promise<PickHit | undefined> {
  const { device, canvas, pick, context, camera, x, y } = options;
  const ids = await readPickPixel(device, canvas, pick, x, y);
  if (ids.instancePickId === 0 || !Number.isFinite(ids.ndcDepth) || ids.ndcDepth >= 1) {
    return undefined;
  }
  return resolvePickHit(context, ids, pickWorldPosition(canvas, camera, x, y, ids.ndcDepth));
}

/** Unprojects a normalized depth from the pick pass at a CSS-local canvas point. */
export function pickWorldPosition(
  canvas: HTMLCanvasElement,
  camera: Camera,
  x: number,
  y: number,
  ndcDepth: number,
): Vec3 {
  const pixel = pickPixelCoordinates(
    x,
    y,
    canvas.getBoundingClientRect(),
    canvas.width,
    canvas.height,
  );
  return unprojectPoint(camera, [
    ((pixel.x + 0.5) / canvas.width) * camera.width,
    ((pixel.y + 0.5) / canvas.height) * camera.height,
    ndcDepth,
  ]);
}

/** Clears the pick render targets, keeping the size-independent readback pool. */
export function resetPickTargets(pick: PickTargets): void {
  pick.texture?.destroy();
  pick.elementTexture?.destroy();
  pick.faceTexture?.destroy();
  pick.nodeTexture?.destroy();
  pick.edgeTexture?.destroy();
  pick.depthTexture?.destroy();
  pick.texture = undefined;
  pick.elementTexture = undefined;
  pick.faceTexture = undefined;
  pick.nodeTexture = undefined;
  pick.edgeTexture = undefined;
  pick.depthTexture = undefined;
  if (pick.depthReadback !== undefined) pick.depthReadback.bindGroup = undefined;
}

/** Destroys the pick render targets and pooled readback buffers. */
export function destroyPickTargets(pick: PickTargets): void {
  pick.readback.closed = true;
  resetPickTargets(pick);
  if (pick.depthReadback !== undefined) destroyPickDepthReadback(pick.depthReadback);
  pick.depthReadback = undefined;
  for (const buffer of pick.readback.inFlight) buffer.destroy();
  for (const entry of pick.readback.free) entry.buffer.destroy();
  pick.readback.inFlight.clear();
  pick.readback.free.length = 0;
  pick.readback.capacities.clear();
}

/** Returns an unmapped readback buffer from the pool, creating one if needed. */
export function acquirePickReadback(
  device: GPUDevice,
  pool: PickReadbackPool,
  size: number,
): GPUBuffer {
  const reusableIndex = pool.free.findIndex((entry) => entry.size >= size);
  const entry = reusableIndex < 0 ? undefined : pool.free.splice(reusableIndex, 1)[0];
  const acquired = entry?.buffer ?? createReadback(device, size);
  pool.capacities.set(acquired, entry?.size ?? size);
  pool.inFlight.add(acquired);
  return acquired;
}

/** Returns a readback buffer to the pool once its map is complete. */
export function releasePickReadback(pool: PickReadbackPool, buffer: GPUBuffer, size: number): void {
  pool.inFlight.delete(buffer);
  if (pool.closed) {
    buffer.destroy();
    return;
  }
  retainFreeReadback(pool, {
    buffer,
    size: Math.max(size, pool.capacities.get(buffer) ?? size),
  });
}

function retainFreeReadback(pool: PickReadbackPool, entry: PickReadbackBuffer): void {
  const retained = pool.free[0];
  if (retained === undefined) {
    // Region tiles are read sequentially, so one largest idle buffer covers reuse.
    pool.free.push(entry);
    return;
  }
  const discarded = entry.size > retained.size ? retained : entry;
  if (discarded === retained) pool.free[0] = entry;
  discarded.buffer.destroy();
  pool.capacities.delete(discarded.buffer);
}

function createReadback(device: GPUDevice, size: number): GPUBuffer {
  return device.createBuffer({
    label: "femgx pick readback",
    size,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
}
