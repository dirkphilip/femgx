const DEPTH_RESULT_OFFSET = 8;
const DEPTH_READBACK_OFFSET = 256 * 4;

const depthReadbackShader = /* wgsl */ `
struct DepthRequest {
  x: u32,
  y: u32,
  depth: f32,
  _padding: u32,
};

@group(0) @binding(0) var depthTexture: texture_depth_2d;
@group(0) @binding(1) var<storage, read_write> request: DepthRequest;

@compute @workgroup_size(1)
fn computeMain() {
  request.depth = textureLoad(depthTexture, vec2<i32>(i32(request.x), i32(request.y)), 0);
}
`;

/** Device-owned resources for extracting one stored depth pixel. */
export interface PickDepthReadback {
  readonly requestBuffer: GPUBuffer;
  readonly bindGroupLayout: GPUBindGroupLayout;
  readonly pipeline: GPUComputePipeline;
  bindGroup: GPUBindGroup | undefined;
}

/** Creates the reusable compute pipeline and storage used for depth extraction. */
export function createPickDepthReadback(device: GPUDevice): PickDepthReadback {
  const bindGroupLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: "depth" } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
    ],
  });
  const pipeline = device.createComputePipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
    compute: {
      module: device.createShaderModule({ code: depthReadbackShader }),
      entryPoint: "computeMain",
    },
  });
  const requestBuffer = device.createBuffer({
    size: 16,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
  });
  return { requestBuffer, bindGroupLayout, pipeline, bindGroup: undefined };
}

/** Rebinds the depth extractor to a newly created or resized pick depth texture. */
export function bindPickDepth(
  device: GPUDevice,
  readback: PickDepthReadback,
  texture: GPUTexture,
): void {
  readback.bindGroup = device.createBindGroup({
    layout: readback.bindGroupLayout,
    entries: [
      { binding: 0, resource: texture.createView({ aspect: "depth-only" }) },
      { binding: 1, resource: { buffer: readback.requestBuffer } },
    ],
  });
}

/** Encodes one depth texture load and copies its scalar result into the mapped readback. */
export function encodePickDepthReadback(
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  readback: PickDepthReadback,
  destination: GPUBuffer,
  pixel: { readonly x: number; readonly y: number },
): void {
  if (readback.bindGroup === undefined) {
    throw new Error("WebGPU picking depth target was not created");
  }
  device.queue.writeBuffer(readback.requestBuffer, 0, new Uint32Array([pixel.x, pixel.y]));
  const pass = encoder.beginComputePass();
  pass.setPipeline(readback.pipeline);
  pass.setBindGroup(0, readback.bindGroup);
  pass.dispatchWorkgroups(1);
  pass.end();
  encoder.copyBufferToBuffer(
    readback.requestBuffer,
    DEPTH_RESULT_OFFSET,
    destination,
    DEPTH_READBACK_OFFSET,
    4,
  );
}

/** Releases the storage buffer owned by the depth extractor. */
export function destroyPickDepthReadback(readback: PickDepthReadback): void {
  readback.requestBuffer.destroy();
  readback.bindGroup = undefined;
}
