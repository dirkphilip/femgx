import { COLOR_SAMPLE_COUNT } from "../resources/foundation";
import type { OverlayDepthResources } from "../frame/overlay-depth";
import {
  TRANSPARENCY_ACCUMULATION_FORMAT,
  TRANSPARENCY_REVEALAGE_FORMAT,
} from "../frame/transparency";

/** The visible-frame color, transparency, and depth resources owned by a draw path. */
export interface ColorTargets {
  msaaColorTexture: GPUTexture | undefined;
  opaqueColorTexture: GPUTexture | undefined;
  msaaAccumulationTexture: GPUTexture | undefined;
  accumulationTexture: GPUTexture | undefined;
  msaaRevealageTexture: GPUTexture | undefined;
  revealageTexture: GPUTexture | undefined;
  depthTexture: GPUTexture | undefined;
  overlayDepthTexture: GPUTexture | undefined;
  overlayDepthResources: OverlayDepthResources | undefined;
  depthWidth: number;
  depthHeight: number;
  compositeBindGroup: GPUBindGroup | undefined;
  overlayDepthBindGroup: GPUBindGroup | undefined;
}

/** An owner with the device and mutable visible-frame target state. */
export interface ColorTargetOwner {
  readonly device: GPUDevice;
  readonly targets: ColorTargets;
}

/** The resources returned by a visible-frame target lookup. */
export interface ReadyColorTargets {
  readonly color: GPUTexture;
  readonly depth: GPUTexture;
  readonly overlayDepth?: GPUTexture;
  readonly opaqueColor?: GPUTexture;
  readonly accumulation?: GPUTexture;
  readonly revealage?: GPUTexture;
  readonly msaaAccumulation?: GPUTexture;
  readonly msaaRevealage?: GPUTexture;
}

interface AllocatedTransparencyTargets {
  readonly opaqueColorTexture: GPUTexture;
  readonly accumulationTexture: GPUTexture;
  readonly revealageTexture: GPUTexture;
  readonly msaaAccumulationTexture: GPUTexture;
  readonly msaaRevealageTexture: GPUTexture;
}

interface ColorTargetOptions {
  readonly width: number;
  readonly height: number;
  readonly colorFormat: GPUTextureFormat;
  readonly depthFormat: GPUTextureFormat;
  readonly requiresTransparency?: boolean;
  readonly requiresOverlays?: boolean;
}

interface BaseTargetOptions {
  readonly device: GPUDevice;
  readonly width: number;
  readonly height: number;
  readonly colorFormat: GPUTextureFormat;
  readonly depthFormat: GPUTextureFormat;
}

/** Allocates only the target set required by the current frame contributors. */
export function ensureColorTargets(
  draw: ColorTargetOwner,
  options: ColorTargetOptions,
): ReadyColorTargets {
  const {
    width,
    height,
    colorFormat,
    depthFormat,
    requiresTransparency = true,
    requiresOverlays = false,
  } = options;
  if (hasBaseTargets(draw.targets, width, height)) {
    syncOverlayDepthTarget(draw, width, height, depthFormat, requiresOverlays);
    if (!requiresTransparency) {
      destroyTransparencyTargets(draw.targets);
      return readyColorTargets(draw.targets);
    }
    if (hasTransparencyTargets(draw.targets)) return readyColorTargets(draw.targets);
    const transparency = allocateTransparencyTargets(draw, width, height, colorFormat);
    publishTransparencyTargets(draw.targets, transparency);
    return readyColorTargets(draw.targets);
  }

  destroyColorTargets(draw.targets);
  const next = createColorTargets();
  try {
    allocateBaseTargets(next, {
      device: draw.device,
      width,
      height,
      colorFormat,
      depthFormat,
    });
    if (requiresOverlays) {
      next.overlayDepthTexture = allocateOverlayDepthTarget(
        draw.device,
        width,
        height,
        depthFormat,
      );
    }
    if (requiresTransparency) {
      const transparency = allocateTransparencyTargets(draw, width, height, colorFormat);
      publishTransparencyTargets(next, transparency);
    }
    publishBaseTargets(draw.targets, next, width, height);
    return readyColorTargets(draw.targets);
  } catch (error) {
    destroyColorTargets(next);
    throw error;
  }
}

function syncOverlayDepthTarget(
  draw: ColorTargetOwner,
  width: number,
  height: number,
  depthFormat: GPUTextureFormat,
  required: boolean,
): void {
  if (!required) {
    draw.targets.overlayDepthTexture?.destroy();
    draw.targets.overlayDepthTexture = undefined;
    draw.targets.overlayDepthResources = undefined;
    draw.targets.overlayDepthBindGroup = undefined;
    return;
  }
  draw.targets.overlayDepthTexture ??= allocateOverlayDepthTarget(
    draw.device,
    width,
    height,
    depthFormat,
  );
}

function allocateOverlayDepthTarget(
  device: GPUDevice,
  width: number,
  height: number,
  depthFormat: GPUTextureFormat,
): GPUTexture {
  return device.createTexture({
    label: "femgx overlay depth texture",
    size: [width, height],
    format: depthFormat,
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });
}

function hasBaseTargets(targets: ColorTargets, width: number, height: number): boolean {
  return (
    targets.depthWidth === width &&
    targets.depthHeight === height &&
    targets.msaaColorTexture !== undefined &&
    targets.depthTexture !== undefined
  );
}

function hasTransparencyTargets(targets: ColorTargets): boolean {
  return (
    targets.opaqueColorTexture !== undefined &&
    targets.msaaAccumulationTexture !== undefined &&
    targets.accumulationTexture !== undefined &&
    targets.msaaRevealageTexture !== undefined &&
    targets.revealageTexture !== undefined
  );
}

function allocateBaseTargets(targets: ColorTargets, options: BaseTargetOptions): void {
  targets.msaaColorTexture = options.device.createTexture({
    label: "femgx msaa color texture",
    size: [options.width, options.height],
    sampleCount: COLOR_SAMPLE_COUNT,
    format: options.colorFormat,
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });
  targets.depthTexture = options.device.createTexture({
    label: "femgx msaa depth texture",
    size: [options.width, options.height],
    sampleCount: COLOR_SAMPLE_COUNT,
    format: options.depthFormat,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  });
}

function allocateTransparencyTargets(
  draw: ColorTargetOwner,
  width: number,
  height: number,
  colorFormat: GPUTextureFormat,
): AllocatedTransparencyTargets {
  const created: GPUTexture[] = [];
  const create = transparencyTextureCreator(draw, width, height, created);
  try {
    const opaqueColorTexture = create(
      "femgx opaque color texture",
      colorFormat,
      GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      false,
    );
    const msaaAccumulationTexture = create(
      "femgx msaa transparency accumulation texture",
      TRANSPARENCY_ACCUMULATION_FORMAT,
      GPUTextureUsage.RENDER_ATTACHMENT,
      true,
    );
    const accumulationTexture = create(
      "femgx transparency accumulation texture",
      TRANSPARENCY_ACCUMULATION_FORMAT,
      GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      false,
    );
    const msaaRevealageTexture = create(
      "femgx msaa transparency revealage texture",
      TRANSPARENCY_REVEALAGE_FORMAT,
      GPUTextureUsage.RENDER_ATTACHMENT,
      true,
    );
    const revealageTexture = create(
      "femgx transparency revealage texture",
      TRANSPARENCY_REVEALAGE_FORMAT,
      GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      false,
    );
    return {
      opaqueColorTexture,
      msaaAccumulationTexture,
      accumulationTexture,
      msaaRevealageTexture,
      revealageTexture,
    };
  } catch (error) {
    for (const texture of created) texture.destroy();
    throw error;
  }
}

function transparencyTextureCreator(
  draw: ColorTargetOwner,
  width: number,
  height: number,
  created: GPUTexture[],
): (
  label: string,
  format: GPUTextureFormat,
  usage: GPUTextureUsageFlags,
  multisampled: boolean,
) => GPUTexture {
  return (label, format, usage, multisampled) => {
    const texture = draw.device.createTexture({
      label,
      size: [width, height],
      ...(multisampled ? { sampleCount: COLOR_SAMPLE_COUNT } : {}),
      format,
      usage,
    });
    created.push(texture);
    return texture;
  };
}

function publishBaseTargets(
  targets: ColorTargets,
  next: ColorTargets,
  width: number,
  height: number,
): void {
  targets.msaaColorTexture = next.msaaColorTexture;
  targets.depthTexture = next.depthTexture;
  targets.depthWidth = width;
  targets.depthHeight = height;
  targets.overlayDepthTexture = next.overlayDepthTexture;
  targets.overlayDepthBindGroup = undefined;
  publishTransparencyTargets(targets, next);
}

function publishTransparencyTargets(
  targets: ColorTargets,
  next: Pick<
    ColorTargets,
    | "opaqueColorTexture"
    | "msaaAccumulationTexture"
    | "accumulationTexture"
    | "msaaRevealageTexture"
    | "revealageTexture"
  >,
): void {
  targets.opaqueColorTexture = next.opaqueColorTexture;
  targets.msaaAccumulationTexture = next.msaaAccumulationTexture;
  targets.accumulationTexture = next.accumulationTexture;
  targets.msaaRevealageTexture = next.msaaRevealageTexture;
  targets.revealageTexture = next.revealageTexture;
  targets.compositeBindGroup = undefined;
}

function destroyTransparencyTargets(targets: ColorTargets): void {
  targets.opaqueColorTexture?.destroy();
  targets.msaaAccumulationTexture?.destroy();
  targets.accumulationTexture?.destroy();
  targets.msaaRevealageTexture?.destroy();
  targets.revealageTexture?.destroy();
  targets.opaqueColorTexture = undefined;
  targets.msaaAccumulationTexture = undefined;
  targets.accumulationTexture = undefined;
  targets.msaaRevealageTexture = undefined;
  targets.revealageTexture = undefined;
  targets.compositeBindGroup = undefined;
}

function readyColorTargets(targets: ColorTargets): ReadyColorTargets {
  if (targets.msaaColorTexture === undefined || targets.depthTexture === undefined) {
    throw new Error("Visible color targets are incomplete");
  }
  return {
    color: targets.msaaColorTexture,
    depth: targets.depthTexture,
    ...(targets.overlayDepthTexture === undefined
      ? {}
      : { overlayDepth: targets.overlayDepthTexture }),
    ...(targets.opaqueColorTexture === undefined
      ? {}
      : { opaqueColor: targets.opaqueColorTexture }),
    ...(targets.accumulationTexture === undefined
      ? {}
      : { accumulation: targets.accumulationTexture }),
    ...(targets.revealageTexture === undefined ? {} : { revealage: targets.revealageTexture }),
    ...(targets.msaaAccumulationTexture === undefined
      ? {}
      : { msaaAccumulation: targets.msaaAccumulationTexture }),
    ...(targets.msaaRevealageTexture === undefined
      ? {}
      : { msaaRevealage: targets.msaaRevealageTexture }),
  };
}

/** Creates an empty visible-frame target state before the first frame. */
export function createColorTargets(): ColorTargets {
  return {
    msaaColorTexture: undefined,
    opaqueColorTexture: undefined,
    msaaAccumulationTexture: undefined,
    accumulationTexture: undefined,
    msaaRevealageTexture: undefined,
    revealageTexture: undefined,
    depthTexture: undefined,
    overlayDepthTexture: undefined,
    overlayDepthResources: undefined,
    depthWidth: 0,
    depthHeight: 0,
    compositeBindGroup: undefined,
    overlayDepthBindGroup: undefined,
  };
}

/** Destroys and clears every visible-frame target, safely including partial state. */
export function destroyColorTargets(targets: ColorTargets): void {
  targets.msaaColorTexture?.destroy();
  destroyTransparencyTargets(targets);
  targets.depthTexture?.destroy();
  targets.overlayDepthTexture?.destroy();
  targets.msaaColorTexture = undefined;
  targets.depthTexture = undefined;
  targets.overlayDepthTexture = undefined;
  targets.overlayDepthResources = undefined;
  targets.depthWidth = 0;
  targets.depthHeight = 0;
  targets.compositeBindGroup = undefined;
  targets.overlayDepthBindGroup = undefined;
}
