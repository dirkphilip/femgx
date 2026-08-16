import {
  createValidatedComputePipeline,
  createValidatedShaderModule,
  type GpuValidationOptions,
} from "../diagnostics/validation";

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
  busy: boolean;
  readonly waiters: Array<() => void>;
  closed: boolean;
}

/** Creates the reusable compute pipeline and storage used for depth extraction. */
export async function createPickDepthReadback(
  device: GPUDevice,
  validation?: GpuValidationOptions,
): Promise<PickDepthReadback> {
  const bindGroupLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: "depth" } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
    ],
  });
  const module = await createValidatedShaderModule(
    device,
    "pick-depth compute/readback",
    depthReadbackShader,
    validation,
  );
  const pipeline = await createValidatedComputePipeline(device, "pick-depth compute/readback", {
    layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
    compute: { module, entryPoint: "computeMain" },
  });
  const requestBuffer = device.createBuffer({
    label: "femgx pick depth request",
    size: 16,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
  });
  return {
    requestBuffer,
    bindGroupLayout,
    pipeline,
    bindGroup: undefined,
    busy: false,
    waiters: [],
    closed: false,
  };
}

/** Acquires exclusive ownership of the shared depth request buffer. */
export function acquirePickDepthReadback(
  readback: PickDepthReadback,
): (() => void) | Promise<(() => void) | undefined> | undefined {
  if (readback.closed) return undefined;
  if (readback.busy) {
    return new Promise<(() => void) | undefined>((resolve) => {
      readback.waiters.push(() => {
        resolve(readback.closed ? undefined : createDepthRelease(readback));
      });
    });
  }
  readback.busy = true;
  return createDepthRelease(readback);
}

/** Rebinds the depth extractor to a newly created or resized pick depth texture. */
export function bindPickDepth(
  device: GPUDevice,
  readback: PickDepthReadback,
  texture: GPUTexture,
): void {
  readback.bindGroup = device.createBindGroup({
    label: "femgx pick depth bind group",
    layout: readback.bindGroupLayout,
    entries: [
      {
        binding: 0,
        resource: texture.createView({
          label: "femgx pick depth readback view",
          aspect: "depth-only",
        }),
      },
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
  readback.closed = true;
  readback.busy = false;
  const waiters = readback.waiters.splice(0);
  for (const waiter of waiters) waiter();
  readback.requestBuffer.destroy();
  readback.bindGroup = undefined;
}

function createDepthRelease(readback: PickDepthReadback): () => void {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const waiter = readback.waiters.shift();
    if (waiter === undefined) readback.busy = false;
    else waiter();
  };
}
