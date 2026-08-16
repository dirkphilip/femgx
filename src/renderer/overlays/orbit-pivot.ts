import { viewMatrix, type Camera } from "../../camera/camera";
import { transformDirection } from "../../math/mat4";
import type { Vec3 } from "../../math/vec3";
import { COLOR_SAMPLE_COUNT } from "../resources/foundation";
import {
  TRANSPARENCY_ACCUMULATION_BLEND_STATE,
  TRANSPARENCY_ACCUMULATION_FORMAT,
  TRANSPARENCY_REVEALAGE_BLEND_STATE,
  TRANSPARENCY_REVEALAGE_FORMAT,
  transparencyOutput,
} from "../frame/transparency";
import {
  createValidatedRenderPipeline,
  createValidatedShaderModule,
  type GpuValidationOptions,
} from "../diagnostics/validation";
import { cameraStruct } from "../shaders/scene";

/** GPU resources for the library-owned screen-space camera-pivot widget. */
export interface OrbitPivotResources {
  readonly buffer: GPUBuffer;
  readonly bindGroup: GPUBindGroup;
  readonly pivotBindGroup: GPUBindGroup;
  readonly visiblePipeline: GPURenderPipeline;
  readonly hiddenPipeline: GPURenderPipeline;
}

/** Pixel dimensions for one high-DPI-stable axis widget. */
export interface OrbitPivotMetrics {
  readonly axisLength: number;
  readonly lineWidth: number;
  readonly arrowLength: number;
  readonly arrowWidth: number;
}

interface OrbitPivotPipelineOptions {
  readonly device: GPUDevice;
  readonly format: GPUTextureFormat;
  readonly depthFormat: GPUTextureFormat;
  readonly validation: GpuValidationOptions | undefined;
}

export interface OrbitPivotPipeline {
  readonly frameLayout: GPUBindGroupLayout;
  readonly pivotLayout: GPUBindGroupLayout;
  readonly visiblePipeline: GPURenderPipeline;
  readonly hiddenPipeline: GPURenderPipeline;
}

interface OrbitPivotResourceOptions {
  readonly device: GPUDevice;
  readonly pipeline: OrbitPivotPipeline;
  readonly cameraBuffer: GPUBuffer;
  readonly deformationBuffer: GPUBuffer;
}

/** Returns the widget dimensions in device pixels for one display density. */
export function orbitPivotMetrics(devicePixelRatio = 1): OrbitPivotMetrics {
  const scale = Number.isFinite(devicePixelRatio) ? devicePixelRatio : 1;
  return {
    axisLength: 28 * scale,
    lineWidth: 3 * scale,
    arrowLength: 8 * scale,
    arrowWidth: 6 * scale,
  };
}

/** Returns the foreshortened screen projection for a world-space axis. */
export function orbitPivotAxisProjection(camera: Camera, axis: Vec3): readonly [number, number] {
  const projected = transformDirection(viewMatrix(camera), axis);
  return [projected[0], projected[1]];
}

/** Validates the visible and weighted-ghost pivot pipelines. */
export async function createOrbitPivotPipeline(
  options: OrbitPivotPipelineOptions,
): Promise<OrbitPivotPipeline> {
  const frameLayout = options.device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: "uniform" } },
      { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: "uniform" } },
    ],
  });
  const pivotLayout = options.device.createBindGroupLayout({
    entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: "uniform" } }],
  });
  const pipelines = await createOrbitPipelines({ ...options, frameLayout, pivotLayout });
  return { frameLayout, pivotLayout, ...pipelines };
}

/** Allocates the widget's buffer and bind groups after its pipeline is valid. */
export function createOrbitPivotResources(options: OrbitPivotResourceOptions): OrbitPivotResources {
  const { device, pipeline, cameraBuffer, deformationBuffer } = options;
  const buffer = device.createBuffer({
    // Pivot data is 56 bytes; uniform structures are rounded to a 16-byte
    // boundary for the implementations used by the supported browsers.
    size: 64,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  try {
    return {
      buffer,
      visiblePipeline: pipeline.visiblePipeline,
      hiddenPipeline: pipeline.hiddenPipeline,
      bindGroup: device.createBindGroup({
        layout: pipeline.frameLayout,
        entries: [
          { binding: 0, resource: { buffer: cameraBuffer } },
          { binding: 1, resource: { buffer: deformationBuffer } },
        ],
      }),
      pivotBindGroup: device.createBindGroup({
        layout: pipeline.pivotLayout,
        entries: [{ binding: 0, resource: { buffer } }],
      }),
    };
  } catch (error) {
    buffer.destroy();
    throw error;
  }
}

interface OrbitPipelineOptions extends OrbitPivotPipelineOptions {
  readonly frameLayout: GPUBindGroupLayout;
  readonly pivotLayout: GPUBindGroupLayout;
}

async function createOrbitPipelines(
  options: OrbitPipelineOptions,
): Promise<Pick<OrbitPivotPipeline, "visiblePipeline" | "hiddenPipeline">> {
  const module = await createValidatedShaderModule(
    options.device,
    "orbit pivot overlay",
    pivotShader,
    options.validation,
  );
  const layout = options.device.createPipelineLayout({
    bindGroupLayouts: [options.frameLayout, options.pivotLayout],
  });
  const create = (
    label: string,
    entryPoint: string,
    depthCompare: GPUCompareFunction,
    depthWriteEnabled: boolean,
    targets: GPUColorTargetState[],
  ): Promise<GPURenderPipeline> =>
    createValidatedRenderPipeline(options.device, label, {
      layout,
      vertex: { module, entryPoint: "vertexMain" },
      fragment: { module, entryPoint, targets },
      primitive: { topology: "triangle-list" },
      depthStencil: {
        format: options.depthFormat,
        depthWriteEnabled,
        depthCompare,
      },
      multisample: { count: COLOR_SAMPLE_COUNT },
    });
  const [visiblePipeline, hiddenPipeline] = await Promise.all([
    create("orbit pivot visible", "visibleFragmentMain", "less-equal", true, [
      { format: options.format },
    ]),
    create("orbit pivot hidden", "hiddenFragmentMain", "greater", false, [
      {
        format: TRANSPARENCY_ACCUMULATION_FORMAT,
        blend: TRANSPARENCY_ACCUMULATION_BLEND_STATE,
      },
      { format: TRANSPARENCY_REVEALAGE_FORMAT, blend: TRANSPARENCY_REVEALAGE_BLEND_STATE },
    ]),
  ]);
  return { visiblePipeline, hiddenPipeline };
}

interface OrbitPivotWriteOptions {
  readonly point: readonly [number, number, number] | undefined;
  readonly camera: Camera;
  readonly devicePixelRatio: number;
}

/** Writes one active pivot orientation and fixed DPR-scaled widget geometry. */
export function writeOrbitPivot(
  device: GPUDevice,
  resources: OrbitPivotResources,
  options: OrbitPivotWriteOptions,
): boolean {
  const { point, camera, devicePixelRatio } = options;
  if (point === undefined) return false;
  const metrics = orbitPivotMetrics(devicePixelRatio);
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
  return true;
}

/** Draws one prepared pivot depth variant from the shared widget geometry. */
export function drawOrbitPivot(
  pass: GPURenderPassEncoder,
  resources: OrbitPivotResources,
  variant: "visible" | "hidden",
): void {
  pass.setPipeline(variant === "visible" ? resources.visiblePipeline : resources.hiddenPipeline);
  pass.setBindGroup(0, resources.bindGroup);
  pass.setBindGroup(1, resources.pivotBindGroup);
  pass.draw(60);
}

const pivotShader = /* wgsl */ `
${cameraStruct}
${transparencyOutput}
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
  output.position = vec4<f32>(clip.xy + offset * clip.w, clip.z, clip.w);
  output.color = color;
  return output;
}
@fragment fn visibleFragmentMain(input: Output) -> @location(0) vec4<f32> {
  return input.color;
}
@fragment fn hiddenFragmentMain(input: Output) -> TransparencyOutput {
  return weightedPresentationTransparency(input.color.rgb, .25);
}`;
