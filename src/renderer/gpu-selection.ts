import {
  cameraStruct,
  deformationStruct,
  frameBindings,
  surfaceLightingFunction,
} from "./gpu-shaders";
import { transparencyOutput } from "./gpu-transparency";

/** Opaque selection output used by the visible depth/stencil pass. */
export const selectionFragmentShader = /* wgsl */ `
@fragment
fn fragmentMain(
  @location(0) @interpolate(flat) color: vec4<f32>,
  @location(2) @interpolate(flat) emissive: f32,
  @location(5) local: vec2<f32>,
  @location(9) @interpolate(flat) selected: u32,
) -> @location(0) vec4<f32> {
  if (selected == 0u || dot(local, local) > 1.0) { discard; }
  return vec4<f32>(color.rgb + vec3<f32>(emissive), 1.0);
}
`;

/** Lit opaque selection output used by selected triangle surfaces. */
export const triangleSelectionFragmentShader = /* wgsl */ `
${cameraStruct}
${deformationStruct}
${frameBindings}
${surfaceLightingFunction}

@fragment
fn fragmentMain(
  @location(0) @interpolate(flat) color: vec4<f32>,
  @location(2) @interpolate(flat) emissive: f32,
  @location(5) local: vec2<f32>,
  @location(8) worldPosition: vec3<f32>,
  @location(9) @interpolate(flat) selected: u32,
) -> @location(0) vec4<f32> {
  if (selected == 0u || dot(local, local) > 1.0) { discard; }
  let litColor = surfaceLighting(
    worldPosition,
    color.rgb,
    camera.keyLightDirection.xyz,
    camera.viewDirection.xyz,
  );
  return vec4<f32>(litColor + vec3<f32>(emissive), 1.0);
}
`;

/** Fixed-alpha hidden selection output for line and point primitives. */
export const selectionTransparencyFragmentShader = /* wgsl */ `
${transparencyOutput}

@fragment
fn fragmentMain(
  @location(0) @interpolate(flat) color: vec4<f32>,
  @location(2) @interpolate(flat) emissive: f32,
  @location(5) local: vec2<f32>,
  @location(9) @interpolate(flat) selected: u32,
) -> TransparencyOutput {
  if (selected == 0u || dot(local, local) > 1.0) { discard; }
  return weightedTransparency(color.rgb + vec3<f32>(emissive), 0.25);
}
`;

/** Fixed-alpha hidden selection output for lit triangle surfaces. */
export const triangleSelectionTransparencyFragmentShader = /* wgsl */ `
${cameraStruct}
${deformationStruct}
${frameBindings}
${surfaceLightingFunction}
${transparencyOutput}

@fragment
fn fragmentMain(
  @location(0) @interpolate(flat) color: vec4<f32>,
  @location(2) @interpolate(flat) emissive: f32,
  @location(5) local: vec2<f32>,
  @location(8) worldPosition: vec3<f32>,
  @location(9) @interpolate(flat) selected: u32,
) -> TransparencyOutput {
  if (selected == 0u || dot(local, local) > 1.0) { discard; }
  let litColor = surfaceLighting(
    worldPosition,
    color.rgb,
    camera.keyLightDirection.xyz,
    camera.viewDirection.xyz,
  );
  return weightedTransparency(litColor + vec3<f32>(emissive), 0.25);
}
`;
