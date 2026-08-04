/** Shared vertex stage for the color and picking render passes. */
export const instanceVertexShader = /* wgsl */ `
struct Camera {
  viewProjection: mat4x4<f32>,
};

// Field layout (byte offsets) must match encodeInstanceRecord in gpu-draw.ts:
// transform 0, color 64, pickId 80, emissive 84, padding 88.
struct Instance {
  transform: mat4x4<f32>,
  color: vec4<f32>,
  pickId: u32,
  emissive: f32,
  _padding: vec2<u32>,
};

@group(0) @binding(0) var<uniform> camera: Camera;
@group(1) @binding(0) var<storage, read> instances: array<Instance>;
@group(1) @binding(1) var<storage, read> drawOrder: array<u32>;

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec4<f32>,
  @location(1) @interpolate(flat) pickId: u32,
  @location(2) @interpolate(flat) emissive: f32,
};

@vertex
fn vertexMain(@location(0) position: vec3<f32>, @builtin(instance_index) instanceIndex: u32) -> VertexOutput {
  let instance = instances[drawOrder[instanceIndex]];
  var output: VertexOutput;
  output.position = camera.viewProjection * instance.transform * vec4<f32>(position, 1.0);
  output.color = instance.color;
  output.pickId = instance.pickId;
  output.emissive = instance.emissive;
  return output;
}
`;

/** Fragment stage for the visible color pass; emissive adds a white glow. */
export const colorFragmentShader = /* wgsl */ `
@fragment
fn fragmentMain(@location(0) color: vec4<f32>, @location(2) @interpolate(flat) emissive: f32) -> @location(0) vec4<f32> {
  return vec4<f32>(color.rgb + vec3<f32>(emissive), color.a);
}
`;

/** Fragment stage for the integer picking pass. */
export const pickFragmentShader = /* wgsl */ `
@fragment
fn fragmentMain(@location(0) color: vec4<f32>, @location(1) @interpolate(flat) pickId: u32) -> @location(0) u32 {
  return pickId;
}
`;
