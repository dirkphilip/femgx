import { encodePickId } from "../../src/renderer/pick-format";
import { READBACK_BYTE_STRIDE } from "../../src/renderer/gpu-pick";

export interface RecordedWrite {
  readonly buffer: GPUBuffer;
  readonly offset: number;
  readonly bytes: Uint8Array;
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
}

/** A draw recorded together with the pipeline tag that issued it. */
export interface PipelineDraw extends DrawCall {
  readonly pipeline: string;
}

export interface FakeTexture {
  destroyed: boolean;
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
  define("GPUShaderStage", { VERTEX: 1, FRAGMENT: 2 });
  define("GPUBufferUsage", {
    UNIFORM: 1,
    COPY_DST: 2,
    VERTEX: 4,
    INDEX: 8,
    STORAGE: 16,
    MAP_READ: 32,
  });
  define("GPUTextureUsage", { RENDER_ATTACHMENT: 1, COPY_SRC: 2 });
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
  return {
    width,
    height,
    clientWidth: width,
    clientHeight: height,
    getContext: () => context,
    getBoundingClientRect: () => ({ width, height }),
  } as unknown as HTMLCanvasElement;
}

/** A GPU device that records buffer writes, creations, and draw calls. */
export function fakeGpuDevice(
  options: { readonly pickValue?: number; readonly elementPickValue?: number } = {},
): FakeGpu {
  const writes: RecordedWrite[] = [];
  const buffers: FakeBuffer[] = [];
  const textures: FakeTexture[] = [];
  const drawCalls: DrawCall[] = [];
  const pipelineDraws: PipelineDraw[] = [];
  const pipelineCalls: unknown[] = [];
  let bindGroupCreations = 0;
  let pipelineCounter = 0;
  let currentPipeline = "none";
  const pickValue = options.pickValue ?? 0;
  const elementPickValue = options.elementPickValue ?? 0;
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
        const bytes =
          data instanceof ArrayBuffer
            ? new Uint8Array(data)
            : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        if (offset % 4 !== 0 || bytes.byteLength % 4 !== 0) {
          throw new Error(
            `writeBuffer requires 4-byte-aligned offset and byte length (offset ${offset}, length ${bytes.byteLength})`,
          );
        }
        writes.push({ buffer, offset, bytes });
      },
      submit: () => undefined,
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
        mapAsync: () => Promise.resolve(),
        getMappedRange: () => {
          const bytes = new Uint8Array(READBACK_BYTE_STRIDE * 2);
          bytes.set(encodePickId(pickValue));
          bytes.set(encodePickId(elementPickValue), READBACK_BYTE_STRIDE);
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
    createShaderModule: () => ({}),
    createRenderPipeline: () => ({
      __tag: `pipeline-${pipelineCounter++}`,
    }),
    createTexture: () => {
      const record: FakeTexture = { destroyed: false };
      textures.push(record);
      return {
        createView: () => ({}),
        destroy: () => {
          record.destroyed = true;
        },
      };
    },
    createCommandEncoder: () => ({
      beginRenderPass: () => {
        const pass = {
          setPipeline: (pipeline: { readonly __tag?: string }) => {
            pipelineCalls.push(pipeline);
            currentPipeline = pipeline.__tag ?? "unknown";
          },
          setBindGroup: () => undefined,
          setVertexBuffer: () => undefined,
          setIndexBuffer: () => undefined,
          drawIndexed: (indexCount: number, instanceCount: number) => {
            drawCalls.push({ indexCount, instanceCount });
            pipelineDraws.push({ pipeline: currentPipeline, indexCount, instanceCount });
          },
          end: () => undefined,
        };
        return pass as unknown as GPURenderPassEncoder;
      },
      finish: () => ({}),
      copyTextureToBuffer: () => undefined,
    }),
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
    lose,
    get textureCreations() {
      return textures.length;
    },
    get bindGroupCreations() {
      return bindGroupCreations;
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
