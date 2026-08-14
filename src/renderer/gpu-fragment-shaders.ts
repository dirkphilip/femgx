/** WGSL clipping helpers shared by the renderer's fragment stages. */
export const sectionPlaneStruct = /* wgsl */ `
struct SectionPlane {
  normalDistance: vec4<f32>,
};
`;

/** Standalone section-plane binding for unlit scene fragment stages. */
export const sectionPlaneBindings = /* wgsl */ `
${sectionPlaneStruct}
@group(0) @binding(2) var<uniform> sectionPlane: SectionPlane;
`;

/** Shared positive-half-space test for scene fragments. */
export const sectionPlaneFunction = /* wgsl */ `
fn sectionPlaneVisible(worldPosition: vec3<f32>) -> bool {
  let normal = sectionPlane.normalDistance.xyz;
  let normalLength = length(normal);
  if (normalLength != normalLength || normalLength <= 1e-6) {
    return true;
  }
  return dot(normal, worldPosition) + sectionPlane.normalDistance.w >= -1e-5;
}
`;

/** Fragment stage for the visible color pass; emissive adds a white glow. */
export const colorFragmentShader = /* wgsl */ `
${sectionPlaneBindings}
${sectionPlaneFunction}

@fragment
fn fragmentMain(
  @location(0) @interpolate(flat) color: vec4<f32>,
  @location(2) @interpolate(flat) emissive: f32,
  @location(5) local: vec2<f32>,
  @location(8) worldPosition: vec3<f32>,
  @location(10) resultColor: vec4<f32>,
  @location(11) @interpolate(flat) resultColorEnabled: u32,
) -> @location(0) vec4<f32> {
  let displayedColor = select(color, resultColor, resultColorEnabled != 0u);
  if (dot(local, local) > 1.0 || displayedColor.a < 1.0 || !sectionPlaneVisible(worldPosition)) { discard; }
  return vec4<f32>(displayedColor.rgb + vec3<f32>(emissive), displayedColor.a);
}
`;

/** Edge color pass with the minimum depth24 offset needed for coplanar lines. */
export const edgeFragmentShader = /* wgsl */ `
${sectionPlaneBindings}
${sectionPlaneFunction}

struct EdgeFragmentOutput {
  @location(0) color: vec4<f32>,
  @builtin(frag_depth) depth: f32,
};

@fragment
fn fragmentMain(
  @builtin(position) fragmentPosition: vec4<f32>,
  @location(0) color: vec4<f32>,
  @location(2) @interpolate(flat) emissive: f32,
  @location(8) worldPosition: vec3<f32>,
) -> EdgeFragmentOutput {
  if (color.a <= 0.0 || !sectionPlaneVisible(worldPosition)) { discard; }
  var output: EdgeFragmentOutput;
  output.color = vec4<f32>(color.rgb + vec3<f32>(emissive), color.a);
  output.depth = max(fragmentPosition.z - 1.0 / 16777215.0, 0.0);
  return output;
}
`;
