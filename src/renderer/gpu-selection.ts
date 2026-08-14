import {
  cameraStruct,
  deformationStruct,
  frameBindings,
  surfaceLightingFunction,
} from "./gpu-shaders";
import { transparencyOutput } from "./gpu-transparency";

const selectionColorFunction = /* wgsl */ `
fn selectionColor(
  color: vec4<f32>,
  resultColor: vec4<f32>,
  resultColorEnabled: u32,
  emissive: f32,
) -> vec3<f32> {
  let tint = color.rgb + vec3<f32>(emissive);
  return select(tint, mix(resultColor.rgb, tint, 0.38), resultColorEnabled != 0u);
}
`;

/** Opaque selection output used by the visible depth/stencil pass. */
export const selectionFragmentShader = /* wgsl */ `
${selectionColorFunction}

@fragment
fn fragmentMain(
  @location(0) @interpolate(flat) color: vec4<f32>,
  @location(2) @interpolate(flat) emissive: f32,
  @location(5) local: vec2<f32>,
  @location(9) @interpolate(flat) selected: u32,
  @location(10) resultColor: vec4<f32>,
  @location(11) @interpolate(flat) resultColorEnabled: u32,
) -> @location(0) vec4<f32> {
  if (selected == 0u || dot(local, local) > 1.0 || color.a <= 0.0) { discard; }
  return vec4<f32>(selectionColor(color, resultColor, resultColorEnabled, emissive), color.a);
}
`;

/** Lit opaque selection output used by selected triangle surfaces. */
export const triangleSelectionFragmentShader = /* wgsl */ `
${cameraStruct}
${deformationStruct}
${frameBindings}
${surfaceLightingFunction}
${selectionColorFunction}

@fragment
fn fragmentMain(
  @location(0) @interpolate(flat) color: vec4<f32>,
  @location(2) @interpolate(flat) emissive: f32,
  @location(5) local: vec2<f32>,
  @location(8) worldPosition: vec3<f32>,
  @location(9) @interpolate(flat) selected: u32,
  @location(10) resultColor: vec4<f32>,
  @location(11) @interpolate(flat) resultColorEnabled: u32,
) -> @location(0) vec4<f32> {
  if (selected == 0u || dot(local, local) > 1.0 || color.a <= 0.0) { discard; }
  let litColor = surfaceLighting(
    worldPosition,
    color.rgb,
    camera.keyLightDirection.xyz,
    camera.viewDirection.xyz,
  );
  let emphasized = vec4<f32>(litColor, color.a);
  return vec4<f32>(selectionColor(emphasized, resultColor, resultColorEnabled, emissive), color.a);
}
`;

/** Fixed-alpha hidden selection output for line and point primitives. */
export const selectionTransparencyFragmentShader = /* wgsl */ `
${transparencyOutput}
${selectionColorFunction}

@fragment
fn fragmentMain(
  @location(0) @interpolate(flat) color: vec4<f32>,
  @location(2) @interpolate(flat) emissive: f32,
  @location(5) local: vec2<f32>,
  @location(9) @interpolate(flat) selected: u32,
  @location(10) resultColor: vec4<f32>,
  @location(11) @interpolate(flat) resultColorEnabled: u32,
) -> TransparencyOutput {
  if (selected == 0u || dot(local, local) > 1.0) { discard; }
  return weightedPresentationTransparency(
    selectionColor(color, resultColor, resultColorEnabled, emissive),
    0.25,
  );
}
`;

/** Fixed-alpha hidden selection output for lit triangle surfaces. */
export const triangleSelectionTransparencyFragmentShader = /* wgsl */ `
${cameraStruct}
${deformationStruct}
${frameBindings}
${surfaceLightingFunction}
${transparencyOutput}
${selectionColorFunction}

@fragment
fn fragmentMain(
  @location(0) @interpolate(flat) color: vec4<f32>,
  @location(2) @interpolate(flat) emissive: f32,
  @location(5) local: vec2<f32>,
  @location(8) worldPosition: vec3<f32>,
  @location(9) @interpolate(flat) selected: u32,
  @location(10) resultColor: vec4<f32>,
  @location(11) @interpolate(flat) resultColorEnabled: u32,
) -> TransparencyOutput {
  if (selected == 0u || dot(local, local) > 1.0) { discard; }
  let litColor = surfaceLighting(
    worldPosition,
    color.rgb,
    camera.keyLightDirection.xyz,
    camera.viewDirection.xyz,
  );
  let emphasized = vec4<f32>(litColor, color.a);
  return weightedPresentationTransparency(
    selectionColor(emphasized, resultColor, resultColorEnabled, emissive),
    0.25,
  );
}
`;
