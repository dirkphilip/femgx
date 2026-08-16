import type { PickTargets } from "./pick";

const attachment = (view: GPUTextureView): GPURenderPassColorAttachment => ({
  view,
  clearValue: { r: 0, g: 0, b: 0, a: 0 },
  loadOp: "clear",
  storeOp: "store",
});

/** Begins the four-target pass that records host-mappable pick ids. */
export function beginPickPass(
  encoder: GPUCommandEncoder,
  pick: PickTargets,
  timestampWrites?: GPURenderPassTimestampWrites,
): GPURenderPassEncoder {
  const textures = [pick.texture, pick.elementTexture, pick.faceTexture, pick.nodeTexture];
  const available = textures.filter((texture): texture is GPUTexture => texture !== undefined);
  if (available.length !== textures.length || pick.depthTexture === undefined) {
    throw new Error("WebGPU picking targets were not created");
  }
  return encoder.beginRenderPass({
    label: "femgx picking",
    colorAttachments: available.map((texture, index) =>
      attachment(texture.createView({ label: `femgx pick attachment ${index}` })),
    ),
    depthStencilAttachment: depthAttachment(pick.depthTexture),
    ...(timestampWrites === undefined ? {} : { timestampWrites }),
  });
}

/** Begins the lazy authored-edge pass over the ordinary pick depth buffer. */
export function beginEdgePickPass(
  encoder: GPUCommandEncoder,
  pick: PickTargets,
  timestampWrites?: GPURenderPassTimestampWrites,
): GPURenderPassEncoder {
  if (pick.edgeTexture === undefined || pick.depthTexture === undefined) {
    throw new Error("Authored-edge picking targets were not created");
  }
  return encoder.beginRenderPass({
    label: "femgx authored edge picking",
    colorAttachments: [
      attachment(pick.edgeTexture.createView({ label: "femgx authored edge pick view" })),
    ],
    depthStencilAttachment: {
      view: pick.depthTexture.createView({ label: "femgx authored edge pick depth view" }),
      depthLoadOp: "load",
      depthStoreOp: "store",
      stencilLoadOp: "load",
      stencilStoreOp: "discard",
    },
    ...(timestampWrites === undefined ? {} : { timestampWrites }),
  });
}

function depthAttachment(texture: GPUTexture): GPURenderPassDepthStencilAttachment {
  return {
    view: texture.createView({ label: "femgx pick depth view" }),
    depthClearValue: 1,
    depthLoadOp: "clear",
    depthStoreOp: "store",
    stencilClearValue: 0,
    stencilLoadOp: "clear",
    stencilStoreOp: "discard",
  };
}
