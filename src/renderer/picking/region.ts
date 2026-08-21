import type { BoxSelectionRect } from "../../interaction/box-selection";
import type { InteractionTarget } from "../../interaction/target-types";
import {
  createElementRegionSelection,
  type ElementRegionSelection,
} from "../../interaction/element-region-selection";
import type { InteractionGranularity } from "../../picking/types";
import type { PickContext } from "../../picking/pick";
import { resolvePick } from "../../picking/pick";
import { decodePickId } from "./pick-format";
import {
  acquirePickReadback,
  READBACK_BYTE_STRIDE,
  releasePickReadback,
  type PickReadbackPool,
  type PickTargets,
} from "./pick";
import { WebGpuPickReadbackError } from "./error";
import {
  decodeElementRegion,
  acquireElementPickScratch,
  releaseElementPickScratch,
  resolveElementRegion,
  type ElementPickScratch,
} from "./element-region";
import type { PickRegionProbe } from "./region-probe";
import {
  decodeRegion,
  resolveTargets,
  type RawIdentities,
  type RegionAttachment,
} from "./region-identities";
import { createPickRegionTargetCollector } from "./region-targets";
import { getPartResource, type DrawResources } from "../resources/draw-resources";

// Keeps common viewport reads in one mapping while bounding high-DPI regions.
const REGION_BYTE_BUDGET = 4 * 1024 * 1024;

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

export type { PickRegionProbe } from "./region-probe";

/** Inputs for the side-effect-free visible-region target query. */
export interface PickRegionOptions {
  readonly device: GPUDevice;
  readonly canvas: HTMLCanvasElement;
  readonly pick: PickTargets;
  readonly readback: PickReadbackPool;
  readonly context: PickContext;
  readonly rect: BoxSelectionRect;
  readonly granularity: InteractionGranularity;
  /** Renderer-owned reusable typed storage for serialized element-region reads. */
  readonly elementScratch?: ElementPickScratch;
  /** Optional internal measurement sink; absent from the package facade. */
  readonly probe?: PickRegionProbe;
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
    if (options.pick.texture !== instanceTexture || options.pick.edgeTexture !== edgeTexture) {
      throw regionTargetsChangedError();
    }
    await readRegionTile(
      options,
      [instanceTexture, edgeTexture],
      tile,
      (bytes, width, height, bytesPerRow) => {
        decodeEdgeRegion(bytes, width, height, bytesPerRow, found);
      },
      "WebGPU authored-edge region readback failed",
    );
  }
  const targets = createPickRegionTargetCollector();
  for (const [instancePickId, edgeIds] of found) {
    const instance = resolvePick(options.context.instances, instancePickId - 1);
    const resource =
      instance === undefined
        ? undefined
        : getPartResource(options.draw, instance.partId, "triangles");
    const edgeResource = resource?.edgePick;
    if (instance === undefined || edgeResource === undefined) continue;
    for (const edgePickId of edgeIds) {
      const key = edgeResource.edgeKeys[edgePickId - 1];
      if (key === undefined) continue;
      targets.add(
        { kind: "edge", partOccurrenceId: instance.partOccurrenceId, key },
        instancePickId,
      );
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
): Promise<ElementRegionSelection | readonly InteractionTarget[]> {
  assertGranularity(options.granularity);
  const bounds = renderPixelRect(options.rect, options.canvas);
  if (bounds === undefined) return emptyElementRegion(options.granularity);
  const textures = regionTextures(options.pick);
  if (textures === undefined) return emptyElementRegion(options.granularity);
  if (options.granularity === "element") {
    return pickElementRegion(options, bounds, textures);
  }
  const attachments = attachmentsFor(options.granularity);
  const identities: RawIdentities = new Map();
  for (const tile of regionTiles(bounds, attachments.length)) {
    assertRegionTexturesCurrent(options.pick, textures);
    await readRegionTile(
      options,
      attachments.map((attachment) => textures[attachment]),
      tile,
      (bytes, width, height, bytesPerRow) => {
        decodeRegion(bytes, width, height, bytesPerRow, {
          attachments,
          identities,
          probe: options.probe,
        });
      },
      "WebGPU pick readback failed: rendering works, but the pick region could not be read back",
    );
  }
  return resolveTargets(identities, options);
}

function emptyElementRegion(
  granularity: InteractionGranularity,
): ElementRegionSelection | readonly InteractionTarget[] {
  return granularity === "element" ? createElementRegionSelection(new Map()) : [];
}

async function pickElementRegion(
  options: PickRegionOptions,
  bounds: RenderPixelRect,
  textures: RegionTextures,
): Promise<ElementRegionSelection> {
  const scratch = acquireElementPickScratch(options.elementScratch);
  try {
    for (const tile of regionTiles(bounds, 2)) {
      assertRegionTexturesCurrent(options.pick, textures);
      await readRegionTile(
        options,
        [textures.instance, textures.element],
        tile,
        (bytes, width, height, bytesPerRow) => {
          decodeElementRegion({ bytes, width, height, bytesPerRow, scratch, probe: options.probe });
        },
        "WebGPU pick readback failed: rendering works, but the pick region could not be read back",
      );
    }
    return resolveElementRegion(scratch, options.context, options.probe);
  } finally {
    releaseElementPickScratch(scratch);
  }
}

function assertRegionTexturesCurrent(pick: PickTargets, snapshot: RegionTextures): void {
  // A later tile must use the same snapshot as earlier tiles; reject a reset
  // instead of mixing old and new frame identities into one selection.
  if (
    pick.texture !== snapshot.instance ||
    pick.elementTexture !== snapshot.element ||
    pick.faceTexture !== snapshot.face ||
    pick.nodeTexture !== snapshot.node
  ) {
    throw regionTargetsChangedError();
  }
}

function regionTargetsChangedError(): WebGpuPickReadbackError {
  return new WebGpuPickReadbackError(
    "WebGPU pick targets changed during region readback; retry the selection",
  );
}

function assertGranularity(value: InteractionGranularity): void {
  if (
    ![
      "assembly",
      "assemblyOccurrence",
      "part",
      "partOccurrence",
      "body",
      "element",
      "face",
      "node",
      "edge",
    ].includes(value)
  ) {
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
    case "assembly":
    case "assemblyOccurrence":
    case "part":
    case "partOccurrence":
      return ["instance"];
    case "body":
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

type RegionTileDecoder = (...args: [Uint8Array, number, number, number]) => void;

async function readRegionTile(
  options: Pick<PickRegionOptions, "device" | "readback">,
  textures: readonly GPUTexture[],
  tile: RenderPixelRect,
  decode: RegionTileDecoder,
  failureMessage: string,
): Promise<void> {
  const { device, readback } = options;
  const width = tile.right - tile.left;
  const height = tile.bottom - tile.top;
  const bytesPerRow = alignedRowBytes(width);
  const bufferSize = bytesPerRow * height * textures.length;
  const buffer = acquirePickReadback(device, readback, bufferSize);
  let mapped = false;
  try {
    const encoder = device.createCommandEncoder({ label: "femgx pick region copy" });
    for (const [index, texture] of textures.entries()) {
      encoder.copyTextureToBuffer(
        { texture, origin: { x: tile.left, y: tile.top } },
        { buffer, offset: bytesPerRow * height * index, bytesPerRow },
        { width, height },
      );
    }
    device.queue.submit([encoder.finish()]);
    await buffer.mapAsync(GPUMapMode.READ);
    mapped = true;
    decode(new Uint8Array(buffer.getMappedRange()), width, height, bytesPerRow);
  } catch (error) {
    throw new WebGpuPickReadbackError(failureMessage, { cause: error });
  } finally {
    if (mapped) buffer.unmap();
    releasePickReadback(readback, buffer, bufferSize);
  }
}

function decodeEdgeRegion(
  bytes: Uint8Array,
  width: number,
  height: number,
  bytesPerRow: number,
  found: Map<number, Set<number>>,
): void {
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
}
