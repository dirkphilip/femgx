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
  destroyCount: number;
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

export interface FakeGpuOptions {
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
  readonly features?: readonly GPUFeatureName[];
  readonly timestampValues?: readonly bigint[];
  readonly timestampPeriod?: number;
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
  readonly querySetCreations: number;
  readonly queryResolveCount: number;
  readonly mapAsyncCount: number;
  /** Render-pipeline descriptors in creation order. */
  readonly renderPipelineDescriptors: readonly GPURenderPipelineDescriptor[];
  /** Shader-module descriptors in creation order. */
  readonly shaderModuleDescriptors: readonly GPUShaderModuleDescriptor[];
  /** Command-buffer submissions in call order. */
  readonly submissionCount: number;
  /** Resolves the device `lost` promise to simulate a GPU device loss. */
  lose(reason?: GPUDeviceLostReason, message?: string): void;
}
