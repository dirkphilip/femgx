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
  targets.opaqueColorTexture?.destroy();
  targets.msaaAccumulationTexture?.destroy();
  targets.accumulationTexture?.destroy();
  targets.msaaRevealageTexture?.destroy();
  targets.revealageTexture?.destroy();
  targets.depthTexture?.destroy();
  targets.msaaColorTexture = undefined;
  targets.opaqueColorTexture = undefined;
  targets.msaaAccumulationTexture = undefined;
  targets.accumulationTexture = undefined;
  targets.msaaRevealageTexture = undefined;
  targets.revealageTexture = undefined;
  targets.depthTexture = undefined;
  targets.depthWidth = 0;
  targets.depthHeight = 0;
  targets.compositeBindGroup = undefined;
}
