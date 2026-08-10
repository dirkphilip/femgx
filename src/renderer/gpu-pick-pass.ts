import type { PickTargets } from "./gpu-pick";

const attachment = (view: GPUTextureView): GPURenderPassColorAttachment => ({
  view,
  clearValue: { r: 0, g: 0, b: 0, a: 0 },
  loadOp: "clear",
  storeOp: "store",
});

/** Begins the four-target pass that records host-mappable pick ids. */
export function beginPickPass(encoder: GPUCommandEncoder, pick: PickTargets): GPURenderPassEncoder {
  const textures = [pick.texture, pick.elementTexture, pick.faceTexture, pick.nodeTexture];
  const available = textures.filter((texture): texture is GPUTexture => texture !== undefined);
  if (available.length !== textures.length || pick.depthTexture === undefined) {
    throw new Error("WebGPU picking targets were not created");
  }
  return encoder.beginRenderPass({
    colorAttachments: available.map((texture) => attachment(texture.createView())),
    depthStencilAttachment: depthAttachment(pick.depthTexture),
  });
}

function depthAttachment(texture: GPUTexture): GPURenderPassDepthStencilAttachment {
  return {
    view: texture.createView(),
    depthClearValue: 1,
    depthLoadOp: "clear",
    depthStoreOp: "store",
    stencilClearValue: 0,
    stencilLoadOp: "clear",
    stencilStoreOp: "discard",
  };
}
