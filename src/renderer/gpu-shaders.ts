/** Shared vertex stage for the color and picking render passes. */
export const instanceVertexShader = /* wgsl */ `
struct Camera {
  viewProjection: mat4x4<f32>,
};

struct Instance {
  transform: mat4x4<f32>,
  color: vec4<f32>,
  pickId: u32,
  _padding: vec3<u32>,
};

@group(0) @binding(0) var<uniform> camera: Camera;
@group(1) @binding(0) var<storage, read> instances: array<Instance>;

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec4<f32>,
  @location(1) pickId: u32,
};

@vertex
fn vertexMain(@location(0) position: vec3<f32>, @builtin(instance_index) instanceIndex: u32) -> VertexOutput {
  let instance = instances[instanceIndex];
  var output: VertexOutput;
  output.position = camera.viewProjection * instance.transform * vec4<f32>(position, 1.0);
  output.color = instance.color;
  output.pickId = instance.pickId;
  return output;
}
`;

/** Fragment stage for the visible color pass. */
export const colorFragmentShader = /* wgsl */ `
@fragment
fn fragmentMain(@location(0) color: vec4<f32>) -> @location(0) vec4<f32> {
  return color;
}
`;

/** Fragment stage for the integer picking pass. */
export const pickFragmentShader = /* wgsl */ `
@fragment
fn fragmentMain(@location(1) pickId: u32) -> @location(0) u32 {
  return pickId;
}
`;
