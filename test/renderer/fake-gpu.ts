import { encodePickId } from "../../src/renderer/picking/pick-format";
import { READBACK_BYTE_STRIDE } from "../../src/renderer/picking/gpu-pick";

export interface RecordedWrite {
  readonly buffer: GPUBuffer;
  readonly offset: number;
  readonly bytes: Uint8Array;
  readonly source: ArrayBufferView | ArrayBuffer;
}

export interface FakeBuffer {
  readonly size: number;
  readonly usage: number;
  destroyed: boolean;
  /** The GPUBuffer object returned to the caller, for write matching. */
  resource: GPUBuffer;
}

export interface DrawCall {
  readonly indexCount: number;
  readonly instanceCount: number;
  readonly firstIndex?: number;
  readonly firstInstance?: number;
}

/** A draw recorded together with the pipeline tag that issued it. */
export interface PipelineDraw extends DrawCall {
  readonly pipeline: string;
}

export interface FakeTexture {
  readonly descriptor: GPUTextureDescriptor;
  destroyed: boolean;
  destroyCount: number;
}

export interface BufferCopy {
  readonly sourceOffset: number;
  readonly destinationOffset: number;
  readonly size: number;
}

export interface FakeGpu {
  readonly device: GPUDevice;
  readonly lost: Promise<GPUDeviceLostInfo>;
  readonly writes: readonly RecordedWrite[];
  readonly buffers: readonly FakeBuffer[];
  readonly textures: readonly FakeTexture[];
  readonly drawCalls: readonly DrawCall[];
  /** Every draw tagged with the pipeline that issued it. */
  readonly pipelineDraws: readonly PipelineDraw[];
  readonly textureCreations: number;
  readonly bindGroupCreations: number;
  /** The pipeline objects passed to `setPipeline`, in call order. */
  readonly pipelineCalls: readonly unknown[];
  readonly bufferCopies: readonly BufferCopy[];
  readonly computeDispatchCount: number;
  /** Render-pipeline descriptors in creation order. */
  readonly renderPipelineDescriptors: readonly GPURenderPipelineDescriptor[];
  /** Shader-module descriptors in creation order. */
  readonly shaderModuleDescriptors: readonly GPUShaderModuleDescriptor[];
  /** Command-buffer submissions in call order. */
  readonly submissionCount: number;
  /** Resolves the device `lost` promise to simulate a GPU device loss. */
  lose(reason?: GPUDeviceLostReason, message?: string): void;
}

/** Defines the WebGPU numeric constants the renderer source references. */
export function installGpuGlobals(): () => void {
  const originals = new Map<string, unknown>();
  const define = (name: string, value: unknown): void => {
    originals.set(name, (globalThis as Record<string, unknown>)[name]);
    Object.defineProperty(globalThis, name, { configurable: true, value });
  };
  define("GPUShaderStage", { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 });
  define("GPUBufferUsage", {
    UNIFORM: 1,
    COPY_DST: 2,
    VERTEX: 4,
    INDEX: 8,
    STORAGE: 16,
    MAP_READ: 32,
    COPY_SRC: 64,
  });
  define("GPUTextureUsage", { RENDER_ATTACHMENT: 1, COPY_SRC: 2, TEXTURE_BINDING: 4 });
  define("GPUMapMode", { READ: 1 });
  define("devicePixelRatio", 1);
  return () => {
    for (const [name, value] of originals) {
      Object.defineProperty(globalThis, name, { configurable: true, value });
    }
  };
}

/** A minimal GPU canvas context for renderer tests. */
export function fakeCanvas(width = 800, height = 600): HTMLCanvasElement {
  const context = {
    configure: () => undefined,
    getCurrentTexture: () => ({ createView: () => ({}) }),
  };
  const canvas = {
    width,
    height,
    clientWidth: width,
    clientHeight: height,
    getContext: () => context,
    getBoundingClientRect: () => ({
      width: canvas.clientWidth,
      height: canvas.clientHeight,
      left: 0,
      top: 0,
    }),
    addEventListener: () => undefined,
    hasPointerCapture: () => false,
    setPointerCapture: () => undefined,
    releasePointerCapture: () => undefined,
  } as unknown as HTMLCanvasElement;
  return canvas;
}

/** A GPU device that records buffer writes, creations, and draw calls. */
export function fakeGpuDevice(
  options: {
    readonly pickValue?: number;
    readonly elementPickValue?: number;
    readonly facePickValue?: number;
    readonly nodePickValue?: number;
    readonly ndcDepth?: number;
    readonly mapAsync?: () => Promise<void>;
    readonly onCopyTextureToBuffer?: (source: GPUTexelCopyTextureInfo) => void;
    readonly shaderMessages?: readonly GPUCompilationMessage[];
    readonly shaderCompilationInfo?: () => Promise<GPUCompilationInfo>;
    readonly renderPipelineError?: string;
    readonly computePipelineError?: string;
    readonly textureCreationErrorAt?: number;
  } = {},
): FakeGpu {
  const writes: RecordedWrite[] = [];
  const buffers: FakeBuffer[] = [];
  const textures: FakeTexture[] = [];
  const drawCalls: DrawCall[] = [];
  const pipelineDraws: PipelineDraw[] = [];
  const pipelineCalls: unknown[] = [];
  const renderPipelineDescriptors: GPURenderPipelineDescriptor[] = [];
  const shaderModuleDescriptors: GPUShaderModuleDescriptor[] = [];
  const bufferCopies: BufferCopy[] = [];
  const textureCopies = new Map<
    GPUBuffer,
    Array<{
      readonly destinationOffset: number;
      readonly bytesPerRow: number;
      readonly width: number;
      readonly height: number;
    }>
  >();
  let bindGroupCreations = 0;
  let computeDispatchCount = 0;
  let submissionCount = 0;
  let pipelineCounter = 0;
  let currentPipeline = "none";
  const pickValue = options.pickValue ?? 0;
  const elementPickValue = options.elementPickValue ?? 0;
  const facePickValue = options.facePickValue ?? 0;
  const nodePickValue = options.nodePickValue ?? 0;
  const ndcDepth = options.ndcDepth ?? 1;
  let resolveLost: (info: GPUDeviceLostInfo) => void = () => undefined;
  const lost = new Promise<GPUDeviceLostInfo>((resolve) => {
    resolveLost = resolve;
  });
  const lose = (reason: GPUDeviceLostReason = "unknown", message = "fake device lost"): void => {
    resolveLost({ reason, message } as GPUDeviceLostInfo);
  };
  const device = {
    lost,
    queue: {
      writeBuffer: (buffer: GPUBuffer, offset: number, data: ArrayBufferView | ArrayBuffer) => {
        const source =
          data instanceof ArrayBuffer
            ? new Uint8Array(data)
            : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        const bytes = new Uint8Array(source.byteLength);
        bytes.set(source);
        if (offset % 4 !== 0 || bytes.byteLength % 4 !== 0) {
          throw new Error(
            `writeBuffer requires 4-byte-aligned offset and byte length (offset ${offset}, length ${bytes.byteLength})`,
          );
        }
        writes.push({ buffer, offset, bytes, source: data });
      },
      submit: () => {
        submissionCount += 1;
      },
    },
    createBuffer: (descriptor: GPUBufferDescriptor) => {
      const record: FakeBuffer = {
        size: descriptor.size,
        usage: descriptor.usage,
        destroyed: false,
        resource: {} as GPUBuffer,
      };
      buffers.push(record);
      const buffer = {
        size: descriptor.size,
        destroy: () => {
          record.destroyed = true;
        },
        mapAsync: options.mapAsync ?? (() => Promise.resolve()),
        getMappedRange: () => {
          const bytes = new Uint8Array(descriptor.size);
          const copies = textureCopies.get(buffer) ?? [];
          const values = [pickValue, elementPickValue, facePickValue, nodePickValue];
          for (const [index, copy] of copies.entries()) {
            const value = encodePickId(values[index] ?? 0);
            for (let y = 0; y < copy.height; y += 1) {
              for (let x = 0; x < copy.width; x += 1) {
                bytes.set(value, copy.destinationOffset + y * copy.bytesPerRow + x * 4);
              }
            }
          }
          if (copies.length === 0) {
            bytes.set(encodePickId(pickValue));
            bytes.set(encodePickId(elementPickValue), READBACK_BYTE_STRIDE);
            bytes.set(encodePickId(facePickValue), READBACK_BYTE_STRIDE * 2);
            bytes.set(encodePickId(nodePickValue), READBACK_BYTE_STRIDE * 3);
          }
          new DataView(bytes.buffer).setFloat32(READBACK_BYTE_STRIDE * 4, ndcDepth, true);
          return bytes.buffer;
        },
        unmap: () => undefined,
      } as unknown as GPUBuffer;
      record.resource = buffer;
      return buffer;
    },
    createBindGroupLayout: () => ({}),
    createBindGroup: () => {
      bindGroupCreations += 1;
      return {};
    },
    createPipelineLayout: () => ({}),
    createSampler: () => ({}),
    createShaderModule: (descriptor: GPUShaderModuleDescriptor) => {
      shaderModuleDescriptors.push(descriptor);
      return {
        getCompilationInfo: () =>
          options.shaderCompilationInfo?.() ??
          Promise.resolve({ messages: options.shaderMessages ?? [] } as GPUCompilationInfo),
      };
    },
    createRenderPipeline: (descriptor: GPURenderPipelineDescriptor) => {
      renderPipelineDescriptors.push(descriptor);
      if (options.renderPipelineError !== undefined) throw new Error(options.renderPipelineError);
      return { __tag: `pipeline-${pipelineCounter++}` };
    },
    createRenderPipelineAsync: (descriptor: GPURenderPipelineDescriptor) =>
      Promise.resolve(
        (
          device as unknown as { createRenderPipeline: typeof device.createRenderPipeline }
        ).createRenderPipeline(descriptor),
      ),
    createComputePipeline: () => {
      if (options.computePipelineError !== undefined) throw new Error(options.computePipelineError);
      return {};
    },
    createComputePipelineAsync: () => {
      if (options.computePipelineError !== undefined) {
        return Promise.reject(new Error(options.computePipelineError));
      }
      return Promise.resolve({});
    },
    pushErrorScope: () => undefined,
    popErrorScope: () => Promise.resolve(null),
    createTexture: (descriptor: GPUTextureDescriptor) => {
      const creation = textures.length + 1;
      if (options.textureCreationErrorAt === creation) {
        throw new Error(`fake texture allocation failed at ${creation}`);
      }
      const record: FakeTexture = { descriptor, destroyed: false, destroyCount: 0 };
      textures.push(record);
      return {
        createView: () => ({}),
        destroy: () => {
          record.destroyed = true;
          record.destroyCount += 1;
        },
      };
    },
    createCommandEncoder: () => {
      const textureCopyBuffers = new Set<GPUBuffer>();
      return {
        beginRenderPass: () => {
          const pass = {
            setPipeline: (pipeline: { readonly __tag?: string }) => {
              pipelineCalls.push(pipeline);
              currentPipeline = pipeline.__tag ?? "unknown";
            },
            setBindGroup: () => undefined,
            setStencilReference: () => undefined,
            setVertexBuffer: () => undefined,
            setIndexBuffer: () => undefined,
            drawIndexed: (
              indexCount: number,
              instanceCount: number,
              firstIndex = 0,
              _baseVertex = 0,
              firstInstance = 0,
            ) => {
              const call: DrawCall = {
                indexCount,
                instanceCount,
                ...(firstIndex === 0 ? {} : { firstIndex }),
                ...(firstInstance === 0 ? {} : { firstInstance }),
              };
              drawCalls.push(call);
              pipelineDraws.push({ pipeline: currentPipeline, ...call });
            },
            draw: () => undefined,
            end: () => undefined,
          };
          return pass as unknown as GPURenderPassEncoder;
        },
        beginComputePass: () =>
          ({
            setPipeline: () => undefined,
            setBindGroup: () => undefined,
            dispatchWorkgroups: () => {
              computeDispatchCount += 1;
            },
            end: () => undefined,
          }) as unknown as GPUComputePassEncoder,
        finish: () => ({}),
        copyTextureToBuffer: (
          source: GPUTexelCopyTextureInfo,
          destination: GPUTexelCopyBufferInfo,
          copySize: GPUExtent3DStrict,
        ) => {
          options.onCopyTextureToBuffer?.(source);
          const target = destination.buffer;
          if (!textureCopyBuffers.has(target)) {
            textureCopies.set(target, []);
            textureCopyBuffers.add(target);
          }
          const copies = textureCopies.get(target) ?? [];
          const extent = copySize as unknown as {
            readonly width?: number;
            readonly height?: number;
          };
          copies.push({
            destinationOffset: destination.offset ?? 0,
            bytesPerRow: destination.bytesPerRow ?? 0,
            width: Array.isArray(copySize) ? Number(copySize[0]) : Number(extent.width),
            height: Array.isArray(copySize) ? Number(copySize[1]) : Number(extent.height),
          });
          textureCopies.set(target, copies);
        },
        copyBufferToBuffer: (
          _source: GPUBuffer,
          sourceOffset: number,
          _destination: GPUBuffer,
          destinationOffset: number,
          size: number,
        ) => {
          bufferCopies.push({ sourceOffset, destinationOffset, size });
        },
      };
    },
  };
  return {
    device: device as unknown as GPUDevice,
    lost,
    writes,
    buffers,
    textures,
    drawCalls,
    pipelineDraws,
    pipelineCalls,
    renderPipelineDescriptors,
    shaderModuleDescriptors,
    bufferCopies,
    lose,
    get textureCreations() {
      return textures.length;
    },
    get bindGroupCreations() {
      return bindGroupCreations;
    },
    get submissionCount() {
      return submissionCount;
    },
    get computeDispatchCount() {
      return computeDispatchCount;
    },
  };
}

/**
 * Installs a navigator whose adapter requests each yield a fake device,
 * returning the created devices in request order so tests can drive loss and
 * recovery against the whole device sequence. `seed` is a device that already
 * exists (used by the initial bundle) and is recorded but never served, so
 * recovery requests always yield a fresh device.
 */
export function installFreshDeviceNavigator(seed?: FakeGpu): readonly FakeGpu[] {
  const gpus: FakeGpu[] = seed === undefined ? [] : [seed];
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      gpu: {
        getPreferredCanvasFormat: () => "bgra8unorm",
        requestAdapter: () => {
          const gpu = fakeGpuDevice();
          gpus.push(gpu);
          return Promise.resolve({ requestDevice: () => Promise.resolve(gpu.device) });
        },
      },
    },
  });
  return gpus;
}
