import type { BoxSelectionRect } from "../../interaction/box-selection";
import type { InteractionTarget } from "../../interaction/target-types";
import type { InteractionGranularity } from "../../picking/types";
import type { PickContext } from "../../picking/pick";
import { resolvePick } from "../../picking/pick";
import { decodePickId } from "./pick-format";
import { createPickRegionTargetResolver } from "./region-resolver";
import {
  acquirePickReadback,
  READBACK_BYTE_STRIDE,
  releasePickReadback,
  type PickReadbackPool,
  type PickTargets,
} from "./pick";
import { WebGpuPickReadbackError } from "./error";
import { createPickRegionTargetCollector } from "./region-targets";
import { getPartResource, type DrawResources } from "../resources/draw-resources";

// Keeps common viewport reads in one mapping while bounding high-DPI regions.
const REGION_BYTE_BUDGET = 4 * 1024 * 1024;

type RegionAttachment = "instance" | "element" | "face" | "node";

interface RenderPixelRect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

interface RegionTextures {
  readonly instance: GPUTexture;
  readonly element: GPUTexture;
  readonly face: GPUTexture;
  readonly node: GPUTexture;
}

interface RawIdentity {
  instancePickId: number;
  elementPickId: number;
  facePickId: number;
  nodePickId: number;
}

type RawIdentities = Map<number, Map<number, RawIdentity>>;

/** Inputs for the side-effect-free visible-region target query. */
export interface PickRegionOptions {
  readonly device: GPUDevice;
  readonly canvas: HTMLCanvasElement;
  readonly pick: PickTargets;
  readonly readback: PickReadbackPool;
  readonly context: PickContext;
  readonly rect: BoxSelectionRect;
  readonly granularity: InteractionGranularity;
}

/** Inputs for the lazy authored-edge region query. */
export interface EdgePickRegionOptions {
  readonly device: GPUDevice;
  readonly canvas: HTMLCanvasElement;
  readonly pick: PickTargets;
  readonly readback: PickReadbackPool;
  readonly context: PickContext;
  readonly draw: DrawResources;
  readonly rect: BoxSelectionRect;
}

/** Reads unique nearest-visible authored edges from the optional edge target. */
export async function pickEdgeTargetsFromRegion(
  options: EdgePickRegionOptions,
): Promise<readonly InteractionTarget[]> {
  const bounds = renderPixelRect(options.rect, options.canvas);
  const instanceTexture = options.pick.texture;
  const edgeTexture = options.pick.edgeTexture;
  if (bounds === undefined || instanceTexture === undefined || edgeTexture === undefined) return [];
  const found = new Map<number, Set<number>>();
  for (const tile of regionTiles(bounds, 2)) {
    await readEdgeRegionTile(options, instanceTexture, edgeTexture, tile, found);
  }
  const targets = createPickRegionTargetCollector();
  for (const [instancePickId, edgeIds] of found) {
    const instance = resolvePick(options.context.instances, instancePickId - 1);
    const edgeResource =
      instance === undefined
        ? undefined
        : getPartResource(options.draw, instance.partId, "triangles")?.edgePick;
    if (instance === undefined || edgeResource === undefined) continue;
    for (const edgePickId of edgeIds) {
      const key = edgeResource.edgeKeys[edgePickId - 1];
      if (key === undefined) continue;
      targets.add({ kind: "edge", instanceId: instance.instanceId, key }, instancePickId);
    }
  }
  return targets.finish();
}

/**
 * Reads nearest visible ID-buffer samples in a CSS rectangle and resolves
 * unique host-facing targets. The rectangle is tiled so mapped allocations
 * stay bounded while every covered render pixel is still visited.
 */
export async function pickTargetsFromRegion(
  options: PickRegionOptions,
): Promise<readonly InteractionTarget[]> {
  assertGranularity(options.granularity);
  const bounds = renderPixelRect(options.rect, options.canvas);
  if (bounds === undefined) return [];
  const textures = regionTextures(options.pick);
  if (textures === undefined) return [];
  const attachments = attachmentsFor(options.granularity);
  const identities: RawIdentities = new Map();
  for (const tile of regionTiles(bounds, attachments.length)) {
    await readRegionTile(options, textures, tile, attachments, identities);
  }
  return resolveTargets(identityValues(identities), options);
}

function assertGranularity(value: InteractionGranularity): void {
  if (!["part", "instance", "body", "block", "element", "face", "node", "edge"].includes(value)) {
    throw new TypeError(`Unsupported pick-region granularity: ${value}`);
  }
}

/** Converts a normalized or reversed CSS rectangle to clamped render pixels. */
export function renderPixelRect(
  rect: BoxSelectionRect,
  canvas: Pick<HTMLCanvasElement, "width" | "height" | "getBoundingClientRect">,
): RenderPixelRect | undefined {
  const values = [rect.left, rect.top, rect.right, rect.bottom, rect.width, rect.height];
  if (values.some((value) => !Number.isFinite(value))) {
    throw new TypeError("Box selection rectangle components must be finite");
  }
  const css = canvas.getBoundingClientRect();
  if (
    !Number.isFinite(css.width) ||
    !Number.isFinite(css.height) ||
    css.width <= 0 ||
    css.height <= 0
  ) {
    return undefined;
  }
  const left = Math.max(0, Math.min(css.width, Math.min(rect.left, rect.right)));
  const right = Math.max(0, Math.min(css.width, Math.max(rect.left, rect.right)));
  const top = Math.max(0, Math.min(css.height, Math.min(rect.top, rect.bottom)));
  const bottom = Math.max(0, Math.min(css.height, Math.max(rect.top, rect.bottom)));
  if (left >= right || top >= bottom || canvas.width < 1 || canvas.height < 1) return undefined;
  const pixels = {
    left: Math.max(0, Math.min(canvas.width, Math.floor((left * canvas.width) / css.width))),
    top: Math.max(0, Math.min(canvas.height, Math.floor((top * canvas.height) / css.height))),
    right: Math.max(0, Math.min(canvas.width, Math.ceil((right * canvas.width) / css.width))),
    bottom: Math.max(0, Math.min(canvas.height, Math.ceil((bottom * canvas.height) / css.height))),
  };
  return pixels.left >= pixels.right || pixels.top >= pixels.bottom ? undefined : pixels;
}

function regionTextures(pick: PickTargets): RegionTextures | undefined {
  if (
    pick.texture === undefined ||
    pick.elementTexture === undefined ||
    pick.faceTexture === undefined ||
    pick.nodeTexture === undefined
  ) {
    return undefined;
  }
  const pixels = {
    instance: pick.texture,
    element: pick.elementTexture,
    face: pick.faceTexture,
    node: pick.nodeTexture,
  };
  return pixels;
}

function attachmentsFor(granularity: InteractionGranularity): readonly RegionAttachment[] {
  switch (granularity) {
    case "part":
    case "instance":
      return ["instance"];
    case "body":
    case "block":
    case "element":
      return ["instance", "element"];
    case "face":
      return ["instance", "face"];
    case "node":
      return ["instance", "node"];
    case "edge":
      return ["instance"];
  }
}

function regionTiles(bounds: RenderPixelRect, attachmentCount: number): readonly RenderPixelRect[] {
  const width = bounds.right - bounds.left;
  const maxPixels = Math.max(1, Math.floor(REGION_BYTE_BUDGET / (4 * attachmentCount)));
  const tileWidth = Math.max(1, Math.min(width, maxPixels));
  const rowStride = alignedRowBytes(tileWidth);
  const tileHeight = Math.max(
    1,
    Math.min(
      bounds.bottom - bounds.top,
      Math.floor(REGION_BYTE_BUDGET / (rowStride * attachmentCount)),
    ),
  );
  const tiles: RenderPixelRect[] = [];
  for (let left = bounds.left; left < bounds.right; left += tileWidth) {
    for (let top = bounds.top; top < bounds.bottom; top += tileHeight) {
      tiles.push({
        left,
        top,
        right: Math.min(bounds.right, left + tileWidth),
        bottom: Math.min(bounds.bottom, top + tileHeight),
      });
    }
  }
  return tiles;
}

function alignedRowBytes(width: number): number {
  return Math.ceil((width * 4) / READBACK_BYTE_STRIDE) * READBACK_BYTE_STRIDE;
}

async function readRegionTile(
  options: PickRegionOptions,
  textures: RegionTextures,
  tile: RenderPixelRect,
  attachments: readonly RegionAttachment[],
  identities: RawIdentities,
): Promise<void> {
  const width = tile.right - tile.left;
  const height = tile.bottom - tile.top;
  const bytesPerRow = alignedRowBytes(width);
  const bufferSize = bytesPerRow * height * attachments.length;
  const buffer = acquirePickReadback(options.device, options.readback, bufferSize);
  let mapped = false;
  try {
    const encoder = options.device.createCommandEncoder();
    for (const [index, attachment] of attachments.entries()) {
      encoder.copyTextureToBuffer(
        { texture: textures[attachment], origin: { x: tile.left, y: tile.top } },
        { buffer, offset: bytesPerRow * height * index, bytesPerRow },
        { width, height },
      );
    }
    options.device.queue.submit([encoder.finish()]);
    await buffer.mapAsync(GPUMapMode.READ);
    mapped = true;
    decodeRegion(new Uint8Array(buffer.getMappedRange()), width, height, bytesPerRow, {
      attachments,
      identities,
    });
  } catch (error) {
    throw new WebGpuPickReadbackError(
      "WebGPU pick readback failed: rendering works, but the pick region could not be read back",
      { cause: error },
    );
  } finally {
    if (mapped) buffer.unmap();
    releasePickReadback(options.readback, buffer, bufferSize);
  }
}

async function readEdgeRegionTile(
  options: EdgePickRegionOptions,
  instanceTexture: GPUTexture,
  edgeTexture: GPUTexture,
  tile: RenderPixelRect,
  found: Map<number, Set<number>>,
): Promise<void> {
  const width = tile.right - tile.left;
  const height = tile.bottom - tile.top;
  const bytesPerRow = alignedRowBytes(width);
  const bufferSize = bytesPerRow * height * 2;
  const buffer = acquirePickReadback(options.device, options.readback, bufferSize);
  let mapped = false;
  try {
    const encoder = options.device.createCommandEncoder();
    for (const [index, texture] of [instanceTexture, edgeTexture].entries()) {
      encoder.copyTextureToBuffer(
        { texture, origin: { x: tile.left, y: tile.top } },
        { buffer, offset: bytesPerRow * height * index, bytesPerRow },
        { width, height },
      );
    }
    options.device.queue.submit([encoder.finish()]);
    await buffer.mapAsync(GPUMapMode.READ);
    mapped = true;
    const bytes = new Uint8Array(buffer.getMappedRange());
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const offset = bytesPerRow * y + x * 4;
        const instancePickId = decodePickId(bytes, offset);
        const edgePickId = decodePickId(bytes, bytesPerRow * height + offset);
        if (instancePickId === 0 || edgePickId === 0) continue;
        const ids = found.get(instancePickId);
        if (ids === undefined) found.set(instancePickId, new Set([edgePickId]));
        else ids.add(edgePickId);
      }
    }
    buffer.unmap();
    mapped = false;
  } catch (error) {
    throw new WebGpuPickReadbackError("WebGPU authored-edge region readback failed", {
      cause: error,
    });
  } finally {
    if (mapped) buffer.unmap();
    releasePickReadback(options.readback, buffer, bufferSize);
  }
}

function decodeRegion(
  bytes: Uint8Array,
  width: number,
  height: number,
  bytesPerRow: number,
  target: {
    readonly attachments: readonly RegionAttachment[];
    readonly identities: RawIdentities;
  },
): void {
  const { attachments, identities } = target;
  const secondaryAttachment = attachments[1];
  const secondaryOffset = secondaryAttachment === undefined ? 0 : bytesPerRow * height;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = bytesPerRow * y + x * 4;
      const instancePickId = decodePickId(bytes, offset);
      if (instancePickId === 0) continue;
      const secondaryPickId =
        secondaryAttachment === undefined ? 0 : decodePickId(bytes, secondaryOffset + offset);
      if (secondaryAttachment !== undefined && secondaryPickId === 0) continue;
      recordIdentity(identities, instancePickId, secondaryAttachment, secondaryPickId);
    }
  }
}

function recordIdentity(
  identities: RawIdentities,
  instancePickId: number,
  secondaryAttachment: RegionAttachment | undefined,
  secondaryPickId: number,
): void {
  let bySecondary = identities.get(instancePickId);
  if (bySecondary === undefined) {
    bySecondary = new Map();
    identities.set(instancePickId, bySecondary);
  }
  if (bySecondary.has(secondaryPickId)) return;
  const ids = { instancePickId, elementPickId: 0, facePickId: 0, nodePickId: 0 };
  if (secondaryAttachment !== undefined) setPickId(ids, secondaryAttachment, secondaryPickId);
  bySecondary.set(secondaryPickId, ids);
}

function* identityValues(identities: RawIdentities): Iterable<RawIdentity> {
  for (const bySecondary of identities.values()) yield* bySecondary.values();
}

function setPickId(ids: RawIdentity, attachment: RegionAttachment, value: number): void {
  switch (attachment) {
    case "instance":
      ids.instancePickId = value;
      return;
    case "element":
      ids.elementPickId = value;
      return;
    case "face":
      ids.facePickId = value;
      return;
    case "node":
      ids.nodePickId = value;
      return;
  }
}

function resolveTargets(
  identities: Iterable<RawIdentity>,
  options: PickRegionOptions,
): readonly InteractionTarget[] {
  const resolveTarget = createPickRegionTargetResolver(options.context, options.granularity);
  const resolved = createPickRegionTargetCollector();
  for (const ids of identities) {
    try {
      const target = resolveTarget(ids);
      if (target === undefined) continue;
      resolved.add(target, ids.instancePickId);
    } catch {
      // Stale or malformed attachment ids are ignored at the ownership boundary.
    }
  }
  return resolved.finish();
}
