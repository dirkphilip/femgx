import { encodePickId } from "@/renderer/picking/pick-format";
import { READBACK_BYTE_STRIDE } from "@/renderer/picking/pick";
import { createRenderPass } from "./render-pass";
import type {
  BufferCopy,
  DrawCall,
  FakeBuffer,
  FakeGpu,
  FakeGpuOptions,
  FakeTexture,
  PipelineDraw,
  RecordedWrite,
} from "./types";

interface FakeGpuState {
  readonly writes: RecordedWrite[];
  readonly buffers: FakeBuffer[];
  readonly textures: FakeTexture[];
  readonly drawCalls: DrawCall[];
  readonly pipelineDraws: PipelineDraw[];
  readonly pipelineCalls: unknown[];
  readonly renderPipelineDescriptors: GPURenderPipelineDescriptor[];
  readonly bindGroupLayoutDescriptors: GPUBindGroupLayoutDescriptor[];
  readonly shaderModuleDescriptors: GPUShaderModuleDescriptor[];
  readonly bufferCopies: BufferCopy[];
  readonly textureCopies: Map<
    GPUBuffer,
    Array<{
      readonly destinationOffset: number;
      readonly bytesPerRow: number;
      readonly width: number;
      readonly height: number;
    }>
  >;
  readonly counters: {
    bindGroupCreations: number;
    computeDispatchCount: number;
    querySetCreations: number;
    queryResolveCount: number;
    mapAsyncCount: number;
    submissionCount: number;
    pipelineCounter: number;
    currentPipeline: string;
  };
  readonly lost: Promise<GPUDeviceLostInfo>;
  readonly lose: (reason?: GPUDeviceLostReason, message?: string) => void;
}

type FakeDevice = Record<string, unknown>;

function createState(): FakeGpuState {
  let resolveLost: (info: GPUDeviceLostInfo) => void = () => undefined;
  const lost = new Promise<GPUDeviceLostInfo>((resolve) => {
    resolveLost = resolve;
  });
  return {
    writes: [],
    buffers: [],
    textures: [],
    drawCalls: [],
    pipelineDraws: [],
    pipelineCalls: [],
    renderPipelineDescriptors: [],
    bindGroupLayoutDescriptors: [],
    shaderModuleDescriptors: [],
    bufferCopies: [],
    textureCopies: new Map(),
    counters: {
      bindGroupCreations: 0,
      computeDispatchCount: 0,
      querySetCreations: 0,
      queryResolveCount: 0,
      mapAsyncCount: 0,
      submissionCount: 0,
      pipelineCounter: 0,
      currentPipeline: "none",
    },
    lost,
    lose: (reason = "unknown", message = "fake device lost") => {
      resolveLost({ reason, message } as GPUDeviceLostInfo);
    },
  };
}

function createQueue(state: FakeGpuState): GPUQueue {
  const writeBuffer = (
    buffer: GPUBuffer,
    offset: number,
    data: ArrayBufferView | ArrayBuffer,
  ): void => {
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
    state.writes.push({ buffer, offset, bytes, source: data });
  };
  return {
    writeBuffer,
    submit: () => {
      state.counters.submissionCount += 1;
    },
    onSubmittedWorkDone: () => Promise.resolve(),
  } as unknown as GPUQueue;
}

function createBuffer(
  state: FakeGpuState,
  options: FakeGpuOptions,
  descriptor: GPUBufferDescriptor,
): GPUBuffer {
  const record: FakeBuffer = {
    size: descriptor.size,
    usage: descriptor.usage,
    destroyed: false,
    destroyCount: 0,
    resource: {} as GPUBuffer,
  };
  state.buffers.push(record);
  const buffer = {
    size: descriptor.size,
    destroy: () => {
      record.destroyCount += 1;
      record.destroyed = true;
    },
    mapAsync: () => {
      state.counters.mapAsyncCount += 1;
      return options.mapAsync?.() ?? Promise.resolve();
    },
    getMappedRange: () => mappedRange(state, options, descriptor, buffer),
    unmap: () => undefined,
  } as unknown as GPUBuffer;
  record.resource = buffer;
  return buffer;
}

function mappedRange(
  state: FakeGpuState,
  options: FakeGpuOptions,
  descriptor: GPUBufferDescriptor,
  buffer: GPUBuffer,
): ArrayBuffer {
  const bytes = new Uint8Array(descriptor.size);
  if (
    options.timestampValues !== undefined &&
    descriptor.size === options.timestampValues.length * BigUint64Array.BYTES_PER_ELEMENT
  ) {
    new BigUint64Array(bytes.buffer).set(options.timestampValues);
    return bytes.buffer;
  }
  const copies = state.textureCopies.get(buffer) ?? [];
  const values = [
    options.pickValue ?? 0,
    options.elementPickValue ?? 0,
    options.facePickValue ?? 0,
    options.nodePickValue ?? 0,
  ];
  for (const [index, copy] of copies.entries()) {
    const value = encodePickId(values[index] ?? 0);
    for (let y = 0; y < copy.height; y += 1) {
      for (let x = 0; x < copy.width; x += 1) {
        bytes.set(value, copy.destinationOffset + y * copy.bytesPerRow + x * 4);
      }
    }
  }
  if (copies.length === 0) {
    bytes.set(encodePickId(options.pickValue ?? 0));
    bytes.set(encodePickId(options.elementPickValue ?? 0), READBACK_BYTE_STRIDE);
    bytes.set(encodePickId(options.facePickValue ?? 0), READBACK_BYTE_STRIDE * 2);
    bytes.set(encodePickId(options.nodePickValue ?? 0), READBACK_BYTE_STRIDE * 3);
  }
  new DataView(bytes.buffer).setFloat32(READBACK_BYTE_STRIDE * 4, options.ndcDepth ?? 1, true);
  return bytes.buffer;
}

function createShaderModule(
  state: FakeGpuState,
  options: FakeGpuOptions,
  descriptor: GPUShaderModuleDescriptor,
): GPUShaderModule {
  state.shaderModuleDescriptors.push(descriptor);
  return {
    getCompilationInfo: () =>
      options.shaderCompilationInfo?.() ??
      Promise.resolve({ messages: options.shaderMessages ?? [] } as GPUCompilationInfo),
  } as GPUShaderModule;
}

function createRenderPipeline(
  state: FakeGpuState,
  options: FakeGpuOptions,
  descriptor: GPURenderPipelineDescriptor,
): GPURenderPipeline {
  state.renderPipelineDescriptors.push(descriptor);
  if (options.renderPipelineError !== undefined) throw new Error(options.renderPipelineError);
  return { __tag: `pipeline-${state.counters.pipelineCounter++}` } as unknown as GPURenderPipeline;
}

function createTexture(
  state: FakeGpuState,
  options: FakeGpuOptions,
  descriptor: GPUTextureDescriptor,
): GPUTexture {
  const creation = state.textures.length + 1;
  if (options.textureCreationErrorAt === creation) {
    throw new Error(`fake texture allocation failed at ${creation}`);
  }
  const record: FakeTexture = { descriptor, destroyed: false, destroyCount: 0 };
  state.textures.push(record);
  return {
    createView: () => ({}),
    destroy: () => {
      record.destroyed = true;
      record.destroyCount += 1;
    },
  } as unknown as GPUTexture;
}

function createComputePass(state: FakeGpuState): GPUComputePassEncoder {
  return {
    setPipeline: () => undefined,
    setBindGroup: () => undefined,
    dispatchWorkgroups: () => {
      state.counters.computeDispatchCount += 1;
    },
    end: () => undefined,
  } as unknown as GPUComputePassEncoder;
}

interface TextureCopyContext {
  readonly state: FakeGpuState;
  readonly options: FakeGpuOptions;
  readonly textureCopyBuffers: Set<GPUBuffer>;
}

function recordTextureCopy(
  context: TextureCopyContext,
  source: GPUTexelCopyTextureInfo,
  destination: GPUTexelCopyBufferInfo,
  copySize: GPUExtent3DStrict,
): void {
  const { state, options, textureCopyBuffers } = context;
  options.onCopyTextureToBuffer?.(source);
  const target = destination.buffer;
  if (!textureCopyBuffers.has(target)) {
    state.textureCopies.set(target, []);
    textureCopyBuffers.add(target);
  }
  const copies = state.textureCopies.get(target) ?? [];
  const extent = copySize as unknown as { readonly width?: number; readonly height?: number };
  copies.push({
    destinationOffset: destination.offset ?? 0,
    bytesPerRow: destination.bytesPerRow ?? 0,
    width: Array.isArray(copySize) ? Number(copySize[0]) : Number(extent.width),
    height: Array.isArray(copySize) ? Number(copySize[1]) : Number(extent.height),
  });
  state.textureCopies.set(target, copies);
}

function createCommandEncoder(state: FakeGpuState, options: FakeGpuOptions): GPUCommandEncoder {
  const textureCopyBuffers = new Set<GPUBuffer>();
  const copyTextureToBuffer = (
    source: GPUTexelCopyTextureInfo,
    destination: GPUTexelCopyBufferInfo,
    copySize: GPUExtent3DStrict,
  ): void => {
    recordTextureCopy({ state, options, textureCopyBuffers }, source, destination, copySize);
  };
  const copyBufferToBuffer = (
    _source: GPUBuffer,
    sourceOffset: number,
    _destination: GPUBuffer,
    destinationOffset: number,
    size: number,
  ): void => {
    state.bufferCopies.push({ sourceOffset, destinationOffset, size });
  };
  return {
    beginRenderPass: () => createRenderPass(state),
    beginComputePass: () => createComputePass(state),
    finish: () => ({}),
    resolveQuerySet: () => {
      state.counters.queryResolveCount += 1;
    },
    copyTextureToBuffer,
    copyBufferToBuffer,
  } as unknown as GPUCommandEncoder;
}

function createDevice(options: FakeGpuOptions, state: FakeGpuState): FakeDevice {
  return {
    lost: state.lost,
    queue: createQueue(state),
    features: new Set(options.features ?? []),
    limits: {
      timestampPeriod: options.timestampPeriod ?? 1,
      maxStorageBufferBindingSize: options.maxStorageBufferBindingSize ?? Number.MAX_SAFE_INTEGER,
    },
    createBuffer: (descriptor: GPUBufferDescriptor) => createBuffer(state, options, descriptor),
    createBindGroupLayout: (descriptor: GPUBindGroupLayoutDescriptor) => {
      state.bindGroupLayoutDescriptors.push(descriptor);
      return {};
    },
    createBindGroup: () => {
      state.counters.bindGroupCreations += 1;
      return {};
    },
    createPipelineLayout: () => ({}),
    createQuerySet: () => {
      state.counters.querySetCreations += 1;
      return { destroy: () => undefined };
    },
    createSampler: () => ({}),
    createShaderModule: (descriptor: GPUShaderModuleDescriptor) =>
      createShaderModule(state, options, descriptor),
    createRenderPipeline: (descriptor: GPURenderPipelineDescriptor) =>
      createRenderPipeline(state, options, descriptor),
    createRenderPipelineAsync: (descriptor: GPURenderPipelineDescriptor) =>
      Promise.resolve(createRenderPipeline(state, options, descriptor)),
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
    createTexture: (descriptor: GPUTextureDescriptor) => createTexture(state, options, descriptor),
    createCommandEncoder: () => createCommandEncoder(state, options),
  };
}

function createFakeGpu(device: FakeDevice, state: FakeGpuState): FakeGpu {
  return {
    device: device as unknown as GPUDevice,
    lost: state.lost,
    writes: state.writes,
    buffers: state.buffers,
    textures: state.textures,
    drawCalls: state.drawCalls,
    pipelineDraws: state.pipelineDraws,
    pipelineCalls: state.pipelineCalls,
    renderPipelineDescriptors: state.renderPipelineDescriptors,
    bindGroupLayoutDescriptors: state.bindGroupLayoutDescriptors,
    shaderModuleDescriptors: state.shaderModuleDescriptors,
    bufferCopies: state.bufferCopies,
    lose: state.lose,
    get textureCreations() {
      return state.textures.length;
    },
    get bindGroupCreations() {
      return state.counters.bindGroupCreations;
    },
    get submissionCount() {
      return state.counters.submissionCount;
    },
    get computeDispatchCount() {
      return state.counters.computeDispatchCount;
    },
    get querySetCreations() {
      return state.counters.querySetCreations;
    },
    get queryResolveCount() {
      return state.counters.queryResolveCount;
    },
    get mapAsyncCount() {
      return state.counters.mapAsyncCount;
    },
  };
}

/** A GPU device that records buffer writes, creations, and draw calls. */
export function fakeGpuDevice(options: FakeGpuOptions = {}): FakeGpu {
  const state = createState();
  return createFakeGpu(createDevice(options, state), state);
}
