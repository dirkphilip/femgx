import { compileScene } from "./runtime";
import { instanceToTarget } from "./pick";
import { resolveInstanceStyle, type InteractionState } from "./interaction";
import { viewProjectionMatrix, type Camera } from "./camera";
import type { Part } from "./part";
import type { Instance, PickTarget } from "./types";
import type { InstanceBatch } from "./batch";
import { colorFragmentShader, instanceVertexShader, pickFragmentShader } from "./gpu-shaders";
import type { Scene } from "./scene";
import {
  createBuffer,
  createDefaultInteraction,
  defaultStyle,
  beginPickPass,
  writeChangedBuffer,
  type BatchResource,
  type PartResource,
  vertexLayout,
} from "./gpu-support";

/** Options for creating a WebGPU renderer. */
export interface WebGpuRendererOptions {
  readonly canvas: HTMLCanvasElement;
  readonly device?: GPUDevice;
  readonly powerPreference?: GPUPowerPreference;
}

/** A renderer that uploads each part once and draws visible instances in batches. */
export interface WebGpuRenderer {
  render(scene: Scene, camera: Camera, interaction?: InteractionState): void;
  pick(x: number, y: number): Promise<PickTarget | undefined>;
  resize(width?: number, height?: number): void;
  destroy(): void;
}

/** Creates a WebGPU renderer, or throws a descriptive error when unavailable. */
export async function createWebGpuRenderer(
  options: WebGpuRendererOptions,
): Promise<WebGpuRenderer> {
  if (!("gpu" in navigator)) {
    throw new Error("WebGPU is unavailable in this browser");
  }
  const adapterOptions =
    options.powerPreference === undefined ? {} : { powerPreference: options.powerPreference };
  const adapter = await navigator.gpu.requestAdapter(adapterOptions);
  if (adapter === null) {
    throw new Error("WebGPU adapter request failed");
  }
  const device = options.device ?? (await adapter.requestDevice());
  return new GpuRenderer(options.canvas, device);
}

class GpuRenderer implements WebGpuRenderer {
  private readonly context: GPUCanvasContext;
  private readonly format: GPUTextureFormat;
  private readonly depthFormat = "depth24plus" as GPUTextureFormat;
  private readonly cameraBuffer: GPUBuffer;
  private readonly cameraBindGroup: GPUBindGroup;
  private readonly colorPipeline: GPURenderPipeline;
  private readonly pickPipeline: GPURenderPipeline;
  private readonly instanceLayout: GPUBindGroupLayout;
  private readonly parts = new Map<number, PartResource>();
  private readonly batches = new Map<number, BatchResource>();
  private pickTexture: GPUTexture | undefined;
  private pickDepthTexture: GPUTexture | undefined;
  private lastInstances: readonly Instance[] = [];
  private destroyed = false;

  public constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly device: GPUDevice,
  ) {
    const context = canvas.getContext("webgpu");
    if (context === null) throw new Error("WebGPU canvas context unavailable");
    this.context = context;
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.instanceLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: "read-only-storage" } },
      ],
    });
    const cameraLayout = device.createBindGroupLayout({
      entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: "uniform" } }],
    });
    this.cameraBuffer = device.createBuffer({
      size: 64,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.cameraBindGroup = device.createBindGroup({
      layout: cameraLayout,
      entries: [{ binding: 0, resource: { buffer: this.cameraBuffer } }],
    });
    const layout = device.createPipelineLayout({
      bindGroupLayouts: [cameraLayout, this.instanceLayout],
    });
    const vertexModule = device.createShaderModule({ code: instanceVertexShader });
    this.colorPipeline = device.createRenderPipeline({
      layout,
      vertex: { module: vertexModule, entryPoint: "vertexMain", buffers: [vertexLayout] },
      fragment: {
        module: device.createShaderModule({ code: colorFragmentShader }),
        entryPoint: "fragmentMain",
        targets: [{ format: this.format }],
      },
      primitive: { topology: "triangle-list", cullMode: "back" },
      depthStencil: { format: this.depthFormat, depthWriteEnabled: true, depthCompare: "less" },
    });
    this.pickPipeline = device.createRenderPipeline({
      layout,
      vertex: { module: vertexModule, entryPoint: "vertexMain", buffers: [vertexLayout] },
      fragment: {
        module: device.createShaderModule({ code: pickFragmentShader }),
        entryPoint: "fragmentMain",
        targets: [{ format: "r32uint" }],
      },
      primitive: { topology: "triangle-list", cullMode: "back" },
      depthStencil: { format: this.depthFormat, depthWriteEnabled: true, depthCompare: "less" },
    });
    this.resize();
  }

  public render(scene: Scene, camera: Camera, interaction = createDefaultInteraction()): void {
    this.ensureAlive();
    const viewProjection = viewProjectionMatrix(camera);
    const compiled = compileScene(scene, { viewProjection });
    this.lastInstances = compiled.instances;
    this.device.queue.writeBuffer(this.cameraBuffer, 0, new Float32Array(viewProjection));
    const encoder = this.device.createCommandEncoder();
    const colorView = this.context.getCurrentTexture().createView();
    const depthTexture = this.device.createTexture({
      size: [this.canvas.width, this.canvas.height],
      format: this.depthFormat,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    const colorPass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: colorView,
          clearValue: { r: 0.04, g: 0.06, b: 0.12, a: 1 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
      depthStencilAttachment: {
        view: depthTexture.createView(),
        depthClearValue: 1,
        depthLoadOp: "clear",
        depthStoreOp: "store",
      },
    });
    this.drawBatches(colorPass, compiled.batches, scene.parts, interaction, this.colorPipeline);
    colorPass.end();
    this.ensurePickTargets();
    const pickTexture = this.pickTexture;
    const pickDepthTexture = this.pickDepthTexture;
    if (pickTexture === undefined || pickDepthTexture === undefined) {
      throw new Error("WebGPU picking targets were not created");
    }
    const pickPass = beginPickPass(encoder, pickTexture, pickDepthTexture);
    this.drawBatches(pickPass, compiled.batches, scene.parts, interaction, this.pickPipeline);
    pickPass.end();
    this.device.queue.submit([encoder.finish()]);
    depthTexture.destroy();
  }

  public async pick(x: number, y: number): Promise<PickTarget | undefined> {
    this.ensureAlive();
    if (this.pickTexture === undefined) return undefined;
    const rect = this.canvas.getBoundingClientRect();
    const pixelX = Math.max(
      0,
      Math.min(this.canvas.width - 1, Math.floor((x / rect.width) * this.canvas.width)),
    );
    const pixelY = Math.max(
      0,
      Math.min(this.canvas.height - 1, Math.floor((y / rect.height) * this.canvas.height)),
    );
    const readback = this.device.createBuffer({
      size: 256,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const encoder = this.device.createCommandEncoder();
    encoder.copyTextureToBuffer(
      { texture: this.pickTexture, origin: { x: pixelX, y: pixelY } },
      { buffer: readback, bytesPerRow: 256 },
      { width: 1, height: 1 },
    );
    this.device.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    const pickId = new Uint32Array(readback.getMappedRange())[0] ?? 0;
    readback.unmap();
    readback.destroy();
    const instance = pickId === 0 ? undefined : this.lastInstances[pickId - 1];
    return instance === undefined ? undefined : instanceToTarget(instance, false);
  }

  public resize(width = this.canvas.clientWidth, height = this.canvas.clientHeight): void {
    this.canvas.width = Math.max(1, Math.floor(width * devicePixelRatio));
    this.canvas.height = Math.max(1, Math.floor(height * devicePixelRatio));
    this.context.configure({ device: this.device, format: this.format, alphaMode: "opaque" });
    this.pickTexture?.destroy();
    this.pickDepthTexture?.destroy();
    this.pickTexture = undefined;
    this.pickDepthTexture = undefined;
  }

  public destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.cameraBuffer.destroy();
    for (const resource of this.parts.values()) {
      resource.vertexBuffer.destroy();
      resource.indexBuffer.destroy();
    }
    for (const resource of this.batches.values()) resource.buffer.destroy();
    this.pickTexture?.destroy();
    this.pickDepthTexture?.destroy();
  }

  private drawBatches(
    pass: GPURenderPassEncoder,
    batches: readonly InstanceBatch[],
    parts: ReadonlyMap<number, Part>,
    interaction: InteractionState,
    pipeline: GPURenderPipeline,
  ): void {
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, this.cameraBindGroup);
    for (const batch of batches) {
      const part = parts.get(batch.partId);
      if (part === undefined) continue;
      const geometry = this.uploadPart(part);
      const instanceBuffer = this.uploadInstances(batch.partId, batch.instances, interaction);
      const bindGroup = this.device.createBindGroup({
        layout: this.instanceLayout,
        entries: [{ binding: 0, resource: { buffer: instanceBuffer } }],
      });
      pass.setBindGroup(1, bindGroup);
      pass.setVertexBuffer(0, geometry.vertexBuffer);
      pass.setIndexBuffer(geometry.indexBuffer, "uint32");
      pass.drawIndexed(geometry.indexCount, batch.instances.length);
    }
  }

  private uploadPart(part: Part): PartResource {
    const existing = this.parts.get(part.id);
    if (existing !== undefined) return existing;
    const vertexBuffer = createBuffer(this.device, part.geometry.positions, GPUBufferUsage.VERTEX);
    const indexBuffer = createBuffer(this.device, part.geometry.indices, GPUBufferUsage.INDEX);
    const resource = { vertexBuffer, indexBuffer, indexCount: part.geometry.indices.length };
    this.parts.set(part.id, resource);
    return resource;
  }

  private uploadInstances(
    partId: number,
    instances: readonly Instance[],
    interaction: InteractionState,
  ): GPUBuffer {
    const existing = this.batches.get(partId);
    const capacity = existing?.capacity ?? 0;
    const resource =
      existing !== undefined && capacity >= instances.length
        ? existing
        : this.createBatchBuffer(partId, instances.length);
    const data = new ArrayBuffer(Math.max(1, instances.length) * 96);
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
    writeChangedBuffer(this.device, resource, data, instances.length * 96);
    return resource.buffer;
  }

  private createBatchBuffer(partId: number, count: number): BatchResource {
    const capacity = Math.max(1, count);
    const resource = {
      buffer: this.device.createBuffer({
        size: capacity * 96,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      }),
      capacity,
      data: new ArrayBuffer(capacity * 96),
      initialized: false,
    };
    this.batches.set(partId, resource);
    return resource;
  }

  private ensurePickTargets(): void {
    if (this.pickTexture !== undefined) return;
    this.pickTexture = this.device.createTexture({
      size: [this.canvas.width, this.canvas.height],
      format: "r32uint",
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
    this.pickDepthTexture = this.device.createTexture({
      size: [this.canvas.width, this.canvas.height],
      format: this.depthFormat,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
  }

  private ensureAlive(): void {
    if (this.destroyed) throw new Error("WebGPU renderer has been destroyed");
  }
}
