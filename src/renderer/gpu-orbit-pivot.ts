import { viewMatrix, type Camera } from "../camera/camera";
import type { Vec3 } from "../math/vec3";
import { COLOR_SAMPLE_COUNT } from "./gpu-support";

/** GPU resources for the library-owned screen-space camera-pivot widget. */
export interface OrbitPivotResources {
  readonly buffer: GPUBuffer;
  readonly bindGroup: GPUBindGroup;
  readonly pivotBindGroup: GPUBindGroup;
  readonly pipeline: GPURenderPipeline;
}

/** Pixel dimensions for one high-DPI-stable axis widget. */
export interface OrbitPivotMetrics {
  readonly axisLength: number;
  readonly lineWidth: number;
  readonly arrowLength: number;
  readonly arrowWidth: number;
}

/** Returns the widget dimensions in device pixels for the current point size. */
export function orbitPivotMetrics(pointSizeDevicePixels: number): OrbitPivotMetrics {
  const scale = Math.max(1, pointSizeDevicePixels) / 8;
  return {
    axisLength: 32 * scale,
    lineWidth: 4 * scale,
    arrowLength: 9 * scale,
    arrowWidth: 7 * scale,
  };
}

/** Returns the foreshortened screen projection for a world-space axis. */
export function orbitPivotAxisProjection(camera: Camera, axis: Vec3): readonly [number, number] {
  const matrix = viewMatrix(camera);
  return [
    (matrix[0] ?? 0) * axis[0] + (matrix[4] ?? 0) * axis[1] + (matrix[8] ?? 0) * axis[2],
    (matrix[1] ?? 0) * axis[0] + (matrix[5] ?? 0) * axis[1] + (matrix[9] ?? 0) * axis[2],
  ];
}

/** Creates the always-visible three-axis widget rendered at an active pivot. */
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
    // Pivot data is 56 bytes; uniform structures are rounded to a 16-byte
    // boundary for the implementations used by the supported browsers.
    size: 64,
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
    multisample: { count: COLOR_SAMPLE_COUNT },
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

/** Draws the pivot after scene geometry as an always-visible screen-space widget. */
interface OrbitPivotDrawOptions {
  readonly point: readonly [number, number, number] | undefined;
  readonly camera: Camera;
  readonly pointSizeDevicePixels: number;
}

/** Writes current pivot orientation and draws the signed, foreshortened axis arrows. */
export function drawOrbitPivot(
  pass: GPURenderPassEncoder,
  resources: OrbitPivotResources,
  options: OrbitPivotDrawOptions,
  device: GPUDevice,
): void {
  const { point, camera, pointSizeDevicePixels } = options;
  if (point === undefined) return;
  const metrics = orbitPivotMetrics(pointSizeDevicePixels);
  const xAxis = orbitPivotAxisProjection(camera, [1, 0, 0]);
  const yAxis = orbitPivotAxisProjection(camera, [0, 1, 0]);
  const zAxis = orbitPivotAxisProjection(camera, [0, 0, 1]);
  device.queue.writeBuffer(
    resources.buffer,
    0,
    new Float32Array([
      point[0],
      point[1],
      point[2],
      1,
      xAxis[0],
      xAxis[1],
      yAxis[0],
      yAxis[1],
      zAxis[0],
      zAxis[1],
      metrics.axisLength,
      metrics.lineWidth,
      metrics.arrowLength,
      metrics.arrowWidth,
    ]),
  );
  pass.setPipeline(resources.pipeline);
  pass.setBindGroup(0, resources.bindGroup);
  pass.setBindGroup(1, resources.pivotBindGroup);
  pass.draw(60);
}

const blendState: GPUBlendState = {
  color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha" },
  alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
};

const pivotShader = /* wgsl */ `
struct Camera { viewProjection: mat4x4<f32>, viewport: vec2<f32>, pointSize: f32, nearPlane: f32, farPlane: f32, ortho: f32, depthSlack: f32, _pad: f32 };
struct Pivot {
  position: vec3<f32>,
  _padding: f32,
  xAxis: vec2<f32>,
  yAxis: vec2<f32>,
  zAxis: vec2<f32>,
  axisLength: f32,
  lineWidth: f32,
  arrowLength: f32,
  arrowWidth: f32,
};
@group(0) @binding(0) var<uniform> camera: Camera;
@group(1) @binding(0) var<uniform> pivot: Pivot;
struct Output {
  @builtin(position) position: vec4<f32>,
  @location(0) @interpolate(flat) color: vec4<f32>,
};

fn axisDirection(axis: u32) -> vec2<f32> {
  switch axis {
    case 0u: { return pivot.xAxis; }
    case 1u: { return pivot.yAxis; }
    default: { return pivot.zAxis; }
  }
}

fn axisColor(axis: u32) -> vec3<f32> {
  switch axis {
    case 0u: { return vec3<f32>(.95, .18, .16); }
    case 1u: { return vec3<f32>(.2, .82, .28); }
    default: { return vec3<f32>(.18, .42, .98); }
  }
}

fn pixelPosition(axis: u32, vertex: u32) -> vec2<f32> {
  let screenAxis = axisDirection(axis);
  let projectionLength = length(screenAxis);
  let axisLength = projectionLength * pivot.axisLength;
  let direction = screenAxis / max(projectionLength, 1e-6);
  let normal = vec2<f32>(-direction.y, direction.x);
  let arrowLength = min(pivot.arrowLength, axisLength * .5);
  let arrowWidth = min(pivot.arrowWidth, axisLength * .4);
  let lineEnd = axisLength - arrowLength;
  let halfWidth = pivot.lineWidth * .5;
  switch vertex % 9u {
    case 0u: { return normal * halfWidth; }
    case 1u: { return direction * lineEnd + normal * halfWidth; }
    case 2u: { return direction * lineEnd - normal * halfWidth; }
    case 3u: { return normal * halfWidth; }
    case 4u: { return direction * lineEnd - normal * halfWidth; }
    case 5u: { return -normal * halfWidth; }
    case 6u: { return direction * axisLength; }
    case 7u: { return direction * lineEnd + normal * arrowWidth; }
    default: { return direction * lineEnd - normal * arrowWidth; }
  }
}

fn centerDot(vertex: u32) -> vec2<f32> {
  let halfWidth = pivot.lineWidth;
  switch vertex {
    case 0u: { return vec2<f32>(-halfWidth, -halfWidth); }
    case 1u: { return vec2<f32>(halfWidth, -halfWidth); }
    case 2u: { return vec2<f32>(halfWidth, halfWidth); }
    case 3u: { return vec2<f32>(-halfWidth, -halfWidth); }
    case 4u: { return vec2<f32>(halfWidth, halfWidth); }
    default: { return vec2<f32>(-halfWidth, halfWidth); }
  }
}

@vertex fn vertexMain(@builtin(vertex_index) index: u32) -> Output {
  let clip = camera.viewProjection * vec4<f32>(pivot.position, 1.);
  var pixels: vec2<f32>;
  var color: vec4<f32>;
  if (index < 54u) {
    let axis = index / 18u;
    let arm = index / 9u % 2u;
    pixels = pixelPosition(axis, index) * select(1., -1., arm == 1u);
    color = vec4<f32>(axisColor(axis), 1.);
  } else {
    pixels = centerDot(index - 54u);
    color = vec4<f32>(1.);
  }
  let offset = pixels * 2. / camera.viewport;
  var output: Output;
  output.position = vec4<f32>(clip.xy + offset * clip.w, 0., clip.w);
  output.color = color;
  return output;
}
@fragment fn fragmentMain(input: Output) -> @location(0) vec4<f32> {
  return input.color;
}`;
