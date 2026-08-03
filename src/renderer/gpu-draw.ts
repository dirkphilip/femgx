import type { Part } from "../geometry/part";
import { resolveInstanceStyle, type InteractionState } from "../interaction/interaction";
import type { InstanceBatch } from "../runtime/batch";
import type { Instance, PartId } from "../scene/types";
import {
  createBuffer,
  defaultStyle,
  writeChangedBuffer,
  type BatchResource,
  type PartResource,
} from "./gpu-support";

/** Byte size of one instance record in the per-part storage buffer. */
const INSTANCE_STRIDE = 96;

/** Per-part geometry and instance storage buffers owned by the draw path. */
export interface DrawResources {
  readonly device: GPUDevice;
  readonly parts: Map<PartId, PartResource>;
  readonly batches: Map<PartId, BatchResource>;
}

/** Per-frame inputs shared by every draw batch of a pass. */
export interface DrawCallContext {
  readonly cameraBindGroup: GPUBindGroup;
  readonly instanceLayout: GPUBindGroupLayout;
  readonly parts: ReadonlyMap<PartId, Part>;
  readonly interaction: InteractionState;
}

/** Creates the draw-path resource owner. */
export function createDrawResources(device: GPUDevice): DrawResources {
  return { device, parts: new Map(), batches: new Map() };
}

/** Returns the cached geometry buffers for a part, uploading them once. */
export function uploadPart(draw: DrawResources, part: Part): PartResource {
  const existing = draw.parts.get(part.id);
  if (existing !== undefined) return existing;
  const vertexBuffer = createBuffer(draw.device, part.geometry.positions, GPUBufferUsage.VERTEX);
  const indexBuffer = createBuffer(draw.device, part.geometry.indices, GPUBufferUsage.INDEX);
  const resource = { vertexBuffer, indexBuffer, indexCount: part.geometry.indices.length };
  draw.parts.set(part.id, resource);
  return resource;
}

/** Encodes instance transforms, styles, and pick ids and uploads only deltas. */
export function uploadInstances(
  draw: DrawResources,
  partId: PartId,
  instances: readonly Instance[],
  interaction: InteractionState,
): GPUBuffer {
  const existing = draw.batches.get(partId);
  const capacity = existing?.capacity ?? 0;
  const resource =
    existing !== undefined && capacity >= instances.length
      ? existing
      : createBatchBuffer(draw, partId, instances.length);
  const data = new ArrayBuffer(Math.max(1, instances.length) * INSTANCE_STRIDE);
  const floats = new Float32Array(data);
  const ids = new Uint32Array(data);
  for (let i = 0; i < instances.length; i += 1) {
    const instance = instances[i];
    if (instance === undefined) continue;
    floats.set(instance.worldTransform, i * 24);
    const style = resolveInstanceStyle(instance, defaultStyle, interaction);
    floats.set(
      [style.color.r, style.color.g, style.color.b, style.color.a * style.opacity],
      i * 24 + 16,
    );
    ids[i * 24 + 20] = instance.index + 1;
  }
  writeChangedBuffer(draw.device, resource, data, instances.length * INSTANCE_STRIDE);
  return resource.buffer;
}

/** Creates a per-part depth attachment sized to the current canvas. */
export function createDepthTexture(
  device: GPUDevice,
  width: number,
  height: number,
  format: GPUTextureFormat,
): GPUTexture {
  return device.createTexture({
    size: [width, height],
    format,
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });
}

/** Begins the visible color render pass with a cleared depth attachment. */
export function beginColorPass(
  encoder: GPUCommandEncoder,
  colorView: GPUTextureView,
  depthView: GPUTextureView,
): GPURenderPassEncoder {
  return encoder.beginRenderPass({
    colorAttachments: [
      {
        view: colorView,
        clearValue: { r: 0.04, g: 0.06, b: 0.12, a: 1 },
        loadOp: "clear",
        storeOp: "store",
      },
    ],
    depthStencilAttachment: {
      view: depthView,
      depthClearValue: 1,
      depthLoadOp: "clear",
      depthStoreOp: "store",
    },
  });
}

/** Issues all instanced draws for the compiled batches onto the given pass. */
export function drawBatches(
  pass: GPURenderPassEncoder,
  draw: DrawResources,
  context: DrawCallContext,
  batches: readonly InstanceBatch[],
  pipeline: GPURenderPipeline,
): void {
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, context.cameraBindGroup);
  for (const batch of batches) {
    const part = context.parts.get(batch.partId);
    if (part === undefined) continue;
    const geometry = uploadPart(draw, part);
    const instanceBuffer = uploadInstances(
      draw,
      batch.partId,
      batch.instances,
      context.interaction,
    );
    const bindGroup = draw.device.createBindGroup({
      layout: context.instanceLayout,
      entries: [{ binding: 0, resource: { buffer: instanceBuffer } }],
    });
    pass.setBindGroup(1, bindGroup);
    pass.setVertexBuffer(0, geometry.vertexBuffer);
    pass.setIndexBuffer(geometry.indexBuffer, "uint32");
    pass.drawIndexed(geometry.indexCount, batch.instances.length);
  }
}

/** Releases every part and batch buffer owned by the draw path. */
export function destroyDrawResources(draw: DrawResources): void {
  for (const resource of draw.parts.values()) {
    resource.vertexBuffer.destroy();
    resource.indexBuffer.destroy();
  }
  for (const resource of draw.batches.values()) resource.buffer.destroy();
}

/** Creates or grows the per-part instance storage buffer. */
function createBatchBuffer(draw: DrawResources, partId: PartId, count: number): BatchResource {
  const capacity = Math.max(1, count);
  const resource = {
    buffer: draw.device.createBuffer({
      size: capacity * INSTANCE_STRIDE,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    }),
    capacity,
    data: new ArrayBuffer(capacity * INSTANCE_STRIDE),
    initialized: false,
  };
  draw.batches.set(partId, resource);
  return resource;
}
