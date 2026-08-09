/** GPU resources for the library-owned screen-space camera-pivot indicator. */
export interface OrbitPivotResources {
  readonly buffer: GPUBuffer;
  readonly bindGroup: GPUBindGroup;
  readonly pivotBindGroup: GPUBindGroup;
  readonly pipeline: GPURenderPipeline;
}

/** Creates the always-visible ring rendered at an active camera pivot. */
export function createOrbitPivotResources(
  device: GPUDevice,
  format: GPUTextureFormat,
  depthFormat: GPUTextureFormat,
  cameraBuffer: GPUBuffer,
  deformationBuffer: GPUBuffer,
): OrbitPivotResources {
  const frameLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: "uniform" } },
      { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: "uniform" } },
    ],
  });
  const pivotLayout = device.createBindGroupLayout({
    entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: "uniform" } }],
  });
  const buffer = device.createBuffer({
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const pipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [frameLayout, pivotLayout] }),
    vertex: { module: device.createShaderModule({ code: pivotShader }), entryPoint: "vertexMain" },
    fragment: {
      module: device.createShaderModule({ code: pivotShader }),
      entryPoint: "fragmentMain",
      targets: [{ format, blend: blendState }],
    },
    primitive: { topology: "triangle-list" },
    depthStencil: { format: depthFormat, depthWriteEnabled: false, depthCompare: "always" },
  });
  return {
    buffer,
    pipeline,
    bindGroup: device.createBindGroup({
      layout: frameLayout,
      entries: [
        { binding: 0, resource: { buffer: cameraBuffer } },
        { binding: 1, resource: { buffer: deformationBuffer } },
      ],
    }),
    pivotBindGroup: device.createBindGroup({
      layout: pivotLayout,
      entries: [{ binding: 0, resource: { buffer } }],
    }),
  };
}

/** Draws the pivot after scene geometry as an always-visible screen-space overlay. */
export function drawOrbitPivot(
  pass: GPURenderPassEncoder,
  resources: OrbitPivotResources,
  point: readonly [number, number, number] | undefined,
  device: GPUDevice,
): void {
  if (point === undefined) return;
  device.queue.writeBuffer(
    resources.buffer,
    0,
    new Float32Array([point[0], point[1], point[2], 1]),
  );
  pass.setPipeline(resources.pipeline);
  pass.setBindGroup(0, resources.bindGroup);
  pass.setBindGroup(1, resources.pivotBindGroup);
  pass.draw(6);
}

const blendState: GPUBlendState = {
  color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha" },
  alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
};

const pivotShader = /* wgsl */ `
struct Camera { viewProjection: mat4x4<f32>, viewport: vec2<f32>, pointSize: f32, _padding: f32 };
struct Pivot { position: vec3<f32>, enabled: f32 };
@group(0) @binding(0) var<uniform> camera: Camera;
@group(1) @binding(0) var<uniform> pivot: Pivot;
struct Output { @builtin(position) position: vec4<f32>, @location(0) local: vec2<f32> };
const corners = array<vec2<f32>, 6>(vec2(-1., -1.), vec2(1., -1.), vec2(-1., 1.), vec2(-1., 1.), vec2(1., -1.), vec2(1., 1.));
@vertex fn vertexMain(@builtin(vertex_index) index: u32) -> Output {
  let local = corners[index];
  let clip = camera.viewProjection * vec4<f32>(pivot.position, 1.);
  let halfExtent = vec2<f32>(36. / camera.viewport.x, 36. / camera.viewport.y);
  var output: Output;
  output.position = vec4<f32>(clip.xy + local * halfExtent * clip.w, 0., clip.w);
  output.local = local;
  return output;
}
@fragment fn fragmentMain(input: Output) -> @location(0) vec4<f32> {
  let radial = length(input.local);
  let crossOutline = (abs(input.local.x) < .11 && abs(input.local.y) < .95)
    || (abs(input.local.y) < .11 && abs(input.local.x) < .95);
  let crossFill = (abs(input.local.x) < .055 && abs(input.local.y) < .9)
    || (abs(input.local.y) < .055 && abs(input.local.x) < .9);
  let ring = radial > .48 && radial < .63;
  let ringOutline = radial > .42 && radial < .69;
  let center = radial < .13;
  if (!crossOutline && !ringOutline && !center) { discard; }
  if (crossFill || ring || center) { return vec4<f32>(1., .72, .05, 1.); }
  return vec4<f32>(.035, .045, .06, 1.);
}`;
