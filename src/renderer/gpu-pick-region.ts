import type { BoxSelectionRect } from "../interaction/box-selection";
import { interactionTargetFromHit } from "../interaction/targets";
import type { InteractionTarget } from "../interaction/target-types";
import type { InteractionGranularity } from "../picking/types";
import { resolvePickHit, type PickContext } from "../picking/pick";
import { decodePickId } from "./pick-format";
import {
  acquirePickReadback,
  READBACK_BYTE_STRIDE,
  releasePickReadback,
  type PickReadbackPool,
  type PickTargets,
} from "./gpu-pick";
import { WebGpuPickReadbackError } from "./gpu-pick-error";

const REGION_BYTE_BUDGET = 64 * 1024;

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

interface ResolvedTarget {
  readonly target: InteractionTarget;
  readonly order: readonly [number, number, string];
}

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
  const identities = new Map<string, RawIdentity>();
  for (const tile of regionTiles(bounds, attachments.length)) {
    await readRegionTile(options, textures, tile, attachments, identities);
  }
  return resolveTargets(identities.values(), options);
}

function assertGranularity(value: InteractionGranularity): void {
  if (!["part", "instance", "body", "element", "face", "node"].includes(value)) {
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
    case "element":
      return ["instance", "element"];
    case "face":
      return ["instance", "face"];
    case "node":
      return ["instance", "node"];
  }
}

function regionTiles(bounds: RenderPixelRect, attachmentCount: number): readonly RenderPixelRect[] {
  const width = bounds.right - bounds.left;
  const maxPixels = Math.max(1, Math.floor(REGION_BYTE_BUDGET / (4 * attachmentCount)));
  const tileWidth = Math.max(1, Math.min(width, 256, Math.floor(Math.sqrt(maxPixels))));
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
  identities: Map<string, RawIdentity>,
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

function decodeRegion(
  bytes: Uint8Array,
  width: number,
  height: number,
  bytesPerRow: number,
  target: {
    readonly attachments: readonly RegionAttachment[];
    readonly identities: Map<string, RawIdentity>;
  },
): void {
  const { attachments, identities } = target;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const ids = { instancePickId: 0, elementPickId: 0, facePickId: 0, nodePickId: 0 };
      for (const [index, attachment] of attachments.entries()) {
        const offset = bytesPerRow * height * index + bytesPerRow * y + x * 4;
        setPickId(ids, attachment, decodePickId(bytes, offset));
      }
      if (ids.instancePickId === 0) continue;
      const keyParts = attachments.map((attachment) => pickIdFor(ids, attachment));
      if (keyParts.some((id) => id === 0)) continue;
      identities.set(JSON.stringify(keyParts), ids);
    }
  }
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

function pickIdFor(pixel: RawIdentity, attachment: RegionAttachment): number {
  switch (attachment) {
    case "instance":
      return pixel.instancePickId;
    case "element":
      return pixel.elementPickId;
    case "face":
      return pixel.facePickId;
    case "node":
      return pixel.nodePickId;
  }
}

function resolveTargets(
  identities: Iterable<RawIdentity>,
  options: PickRegionOptions,
): readonly InteractionTarget[] {
  const resolved = new Map<string, ResolvedTarget>();
  for (const ids of identities) {
    try {
      const hit = resolvePickHit(options.context, ids, [0, 0, 0]);
      if (hit === undefined) continue;
      const target = interactionTargetFromHit(hit, options.granularity);
      if (target === undefined) continue;
      const key = JSON.stringify(target);
      resolved.set(key, { target, order: targetOrder(target, ids.instancePickId) });
    } catch {
      // Stale or malformed attachment ids are ignored at the ownership boundary.
    }
  }
  return [...resolved.values()]
    .sort((a, b) => compareOrder(a.order, b.order))
    .map(({ target }) => target);
}

function targetOrder(
  target: InteractionTarget,
  instancePickId: number,
): readonly [number, number, string] {
  if (target.kind === "part") return [0, target.partId, ""];
  switch (target.kind) {
    case "instance":
      return [instancePickId, 0, ""];
    case "body":
      return [instancePickId, target.bodyId, ""];
    case "element":
      return [instancePickId, target.elementId, ""];
    case "node":
      return [instancePickId, target.nodeId, ""];
    case "face":
      return [instancePickId, target.elementId, String(target.faceIndex)];
  }
}

function compareOrder(
  left: readonly [number, number, string],
  right: readonly [number, number, string],
): number {
  return left[0] - right[0] || left[1] - right[1] || left[2].localeCompare(right[2]);
}
