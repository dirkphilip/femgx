import { COLOR_SAMPLE_COUNT } from "../resources/gpu-support";
import {
  TRANSPARENCY_ACCUMULATION_FORMAT,
  TRANSPARENCY_REVEALAGE_FORMAT,
} from "./gpu-transparency";

/** The visible-frame color, transparency, and depth resources owned by a draw path. */
export interface ColorTargets {
  msaaColorTexture: GPUTexture | undefined;
  opaqueColorTexture: GPUTexture | undefined;
  msaaAccumulationTexture: GPUTexture | undefined;
  accumulationTexture: GPUTexture | undefined;
  msaaRevealageTexture: GPUTexture | undefined;
  revealageTexture: GPUTexture | undefined;
  depthTexture: GPUTexture | undefined;
  depthWidth: number;
  depthHeight: number;
  compositeBindGroup: GPUBindGroup | undefined;
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
  const { width, height, colorFormat, depthFormat, requiresTransparency = true } = options;
  if (hasBaseTargets(draw.targets, width, height)) {
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
    size: [options.width, options.height],
    sampleCount: COLOR_SAMPLE_COUNT,
    format: options.colorFormat,
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });
  targets.depthTexture = options.device.createTexture({
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
  const create = (
    format: GPUTextureFormat,
    usage: GPUTextureUsageFlags,
    multisampled: boolean,
  ): GPUTexture => {
    const texture = draw.device.createTexture({
      size: [width, height],
      ...(multisampled ? { sampleCount: COLOR_SAMPLE_COUNT } : {}),
      format,
      usage,
    });
    created.push(texture);
    return texture;
  };
  try {
    const opaqueColorTexture = create(
      colorFormat,
      GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      false,
    );
    const msaaAccumulationTexture = create(
      TRANSPARENCY_ACCUMULATION_FORMAT,
      GPUTextureUsage.RENDER_ATTACHMENT,
      true,
    );
    const accumulationTexture = create(
      TRANSPARENCY_ACCUMULATION_FORMAT,
      GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      false,
    );
    const msaaRevealageTexture = create(
      TRANSPARENCY_REVEALAGE_FORMAT,
      GPUTextureUsage.RENDER_ATTACHMENT,
      true,
    );
    const revealageTexture = create(
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
    depthWidth: 0,
    depthHeight: 0,
    compositeBindGroup: undefined,
  };
}

/** Destroys and clears every visible-frame target, safely including partial state. */
export function destroyColorTargets(targets: ColorTargets): void {
  targets.msaaColorTexture?.destroy();
  destroyTransparencyTargets(targets);
  targets.depthTexture?.destroy();
  targets.msaaColorTexture = undefined;
  targets.depthTexture = undefined;
  targets.depthWidth = 0;
  targets.depthHeight = 0;
  targets.compositeBindGroup = undefined;
}
