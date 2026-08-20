/** Pipeline state for resolving multisampled opaque depth before native-edge presentation. */
export interface OverlayDepthResources {
  readonly layout: GPUBindGroupLayout;
  readonly pipeline: GPURenderPipeline;
}

interface OverlayDepthTargetOwner {
  readonly device: GPUDevice;
  readonly targets: {
    overlayDepthResources: OverlayDepthResources | undefined;
    overlayDepthBindGroup: GPUBindGroup | undefined;
    depthTexture: GPUTexture | undefined;
  };
}

const overlayDepthShader = /* wgsl */ `
@group(0) @binding(0) var sourceDepth: texture_depth_multisampled_2d;

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> @builtin(position) vec4<f32> {
  let x = f32((vertexIndex << 1u) & 2u);
  let y = f32(vertexIndex & 2u);
  return vec4<f32>(x * 2.0 - 1.0, 1.0 - y * 2.0, 0.0, 1.0);
}

@fragment
fn fragmentMain(@builtin(position) fragmentPosition: vec4<f32>) -> @builtin(frag_depth) f32 {
  let pixel = vec2<i32>(fragmentPosition.xy);
  var furthestDepth = textureLoad(sourceDepth, pixel, 0);
  furthestDepth = max(furthestDepth, textureLoad(sourceDepth, pixel, 1));
  furthestDepth = max(furthestDepth, textureLoad(sourceDepth, pixel, 2));
  return max(furthestDepth, textureLoad(sourceDepth, pixel, 3));
}
`;

/** Creates the active-edge-only depth resolve without changing ordinary surface depth. */
function createOverlayDepthResources(
  device: GPUDevice,
  depthFormat: GPUTextureFormat,
): OverlayDepthResources {
  const layout = device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: "depth", viewDimension: "2d", multisampled: true },
      },
    ],
  });
  const module = device.createShaderModule({
    label: "presentation depth resolve",
    code: overlayDepthShader,
  });
  const pipeline = device.createRenderPipeline({
    label: "presentation depth resolve",
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    vertex: { module, entryPoint: "vertexMain" },
    fragment: { module, entryPoint: "fragmentMain", targets: [] },
    primitive: { topology: "triangle-list" },
    depthStencil: { format: depthFormat, depthWriteEnabled: true, depthCompare: "always" },
  });
  return { layout, pipeline };
}

/** Materializes resolve pipeline state only while depth-tested edge presentation needs it. */
export function ensureOverlayDepthResources(
  draw: OverlayDepthTargetOwner,
  depthFormat: GPUTextureFormat,
): OverlayDepthResources {
  draw.targets.overlayDepthResources ??= createOverlayDepthResources(draw.device, depthFormat);
  return draw.targets.overlayDepthResources;
}

/** Binds the current multisampled surface depth for the active resolve pipeline. */
export function ensureOverlayDepthBindGroup(
  draw: OverlayDepthTargetOwner,
  resources: OverlayDepthResources,
): GPUBindGroup {
  if (draw.targets.overlayDepthBindGroup !== undefined) return draw.targets.overlayDepthBindGroup;
  if (draw.targets.depthTexture === undefined)
    throw new Error("Visible depth target is not initialized");
  draw.targets.overlayDepthBindGroup = createOverlayDepthBindGroup(
    draw.device,
    resources.layout,
    draw.targets.depthTexture,
  );
  return draw.targets.overlayDepthBindGroup;
}

/** Binds the current multisampled surface depth for one presentation resolve. */
export function createOverlayDepthBindGroup(
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  depthTexture: GPUTexture,
): GPUBindGroup {
  return device.createBindGroup({
    label: "femgx overlay depth bind group",
    layout,
    entries: [{ binding: 0, resource: depthTexture.createView({ aspect: "depth-only" }) }],
  });
}
