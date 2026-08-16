import type { PickTargets } from "./pick";

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

/** Begins the lazy authored-edge pass over the ordinary pick depth buffer. */
export function beginEdgePickPass(
  encoder: GPUCommandEncoder,
  pick: PickTargets,
): GPURenderPassEncoder {
  if (pick.edgeTexture === undefined || pick.depthTexture === undefined) {
    throw new Error("Authored-edge picking targets were not created");
  }
  return encoder.beginRenderPass({
    colorAttachments: [attachment(pick.edgeTexture.createView())],
    depthStencilAttachment: {
      view: pick.depthTexture.createView(),
      depthLoadOp: "load",
      depthStoreOp: "store",
      stencilLoadOp: "load",
      stencilStoreOp: "discard",
    },
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
