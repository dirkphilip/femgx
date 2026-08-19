/** Begins the visible color render pass with a cleared multisampled depth attachment. */
export function beginColorPass(
  encoder: GPUCommandEncoder,
  colorView: GPUTextureView,
  depthView: GPUTextureView,
  resolveTarget: GPUTextureView | undefined,
  timestampWrites?: GPURenderPassTimestampWrites,
): GPURenderPassEncoder {
  const colorAttachment: GPURenderPassColorAttachment = {
    view: colorView,
    clearValue: { r: 0, g: 0, b: 0, a: 1 },
    loadOp: "clear",
    storeOp: resolveTarget === undefined ? "store" : "discard",
  };
  if (resolveTarget !== undefined) colorAttachment.resolveTarget = resolveTarget;
  return encoder.beginRenderPass({
    label: "femgx opaque",
    colorAttachments: [colorAttachment],
    depthStencilAttachment: {
      view: depthView,
      depthClearValue: 1,
      depthLoadOp: "clear",
      depthStoreOp: "store",
      stencilClearValue: 0,
      stencilLoadOp: "clear",
      stencilStoreOp: "store",
    },
    ...(timestampWrites === undefined ? {} : { timestampWrites }),
  });
}

/** Targets used by the weighted transparency accumulation pass. */
export interface TransparencyPassTargets {
  readonly accumulationView: GPUTextureView;
  readonly accumulationResolve: GPUTextureView;
  readonly revealageView: GPUTextureView;
  readonly revealageResolve: GPUTextureView;
}

/** Begins weighted transparency accumulation over the opaque depth buffer. */
export function beginTransparencyPass(
  encoder: GPUCommandEncoder,
  targets: TransparencyPassTargets,
  depthView: GPUTextureView,
  timestampWrites?: GPURenderPassTimestampWrites,
): GPURenderPassEncoder {
  return encoder.beginRenderPass({
    label: "femgx transparency",
    colorAttachments: [
      {
        view: targets.accumulationView,
        resolveTarget: targets.accumulationResolve,
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp: "clear",
        storeOp: "discard",
      },
      {
        view: targets.revealageView,
        resolveTarget: targets.revealageResolve,
        clearValue: { r: 1, g: 1, b: 1, a: 1 },
        loadOp: "clear",
        storeOp: "discard",
      },
    ],
    depthStencilAttachment: {
      view: depthView,
      depthLoadOp: "load",
      depthStoreOp: "store",
      stencilLoadOp: "load",
      stencilStoreOp: "discard",
    },
    ...(timestampWrites === undefined ? {} : { timestampWrites }),
  });
}

/** Begins the final composite pass and leaves depth available for overlays. */
export function beginCompositePass(
  encoder: GPUCommandEncoder,
  colorView: GPUTextureView,
  resolveTarget: GPUTextureView,
  depthView: GPUTextureView,
  timestampWrites?: GPURenderPassTimestampWrites,
): GPURenderPassEncoder {
  return encoder.beginRenderPass({
    label: "femgx composite",
    colorAttachments: [
      {
        view: colorView,
        resolveTarget,
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: "clear",
        storeOp: "discard",
      },
    ],
    depthStencilAttachment: {
      view: depthView,
      depthLoadOp: "load",
      depthStoreOp: "store",
      stencilLoadOp: "load",
      stencilStoreOp: "discard",
    },
    ...(timestampWrites === undefined ? {} : { timestampWrites }),
  });
}
