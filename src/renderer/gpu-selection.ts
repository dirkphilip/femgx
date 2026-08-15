import {
  cameraStruct,
  deformationStruct,
  frameBindings,
  sectionPlaneBindings,
  sectionPlaneFunction,
  surfaceLightingFunction,
} from "./gpu-shaders";
import { transparencyOutput } from "./gpu-transparency";

const selectionColorFunction = /* wgsl */ `
fn selectionColor(
  color: vec4<f32>,
  emissive: f32,
) -> vec3<f32> {
  let tint = color.rgb + vec3<f32>(emissive);
  return tint;
}

fn visibleSelectionAlpha(baseAlpha: f32) -> f32 {
  return select(baseAlpha, 1.0, baseAlpha >= 1.0);
}
`;

function visibleSelectionFragment(lit: boolean): string {
  const lighting = lit
    ? /* wgsl */ `${cameraStruct}${deformationStruct}${frameBindings}${surfaceLightingFunction}`
    : "";
  const output = lit
    ? /* wgsl */ `surfaceLighting(
      worldPosition,
      selectedColor,
      camera.keyLightDirection.xyz,
      camera.viewDirection.xyz,
    )`
    : "selectedColor";
  return /* wgsl */ `
${lighting}
${selectionColorFunction}
${sectionPlaneBindings}
${sectionPlaneFunction}

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
  if (selected == 0u || dot(local, local) > 1.0 || color.a <= 0.0 || !sectionPlaneVisible(worldPosition)) { discard; }
  let selectedColor = selectionColor(color, emissive);
  return vec4<f32>(
    ${output},
    visibleSelectionAlpha(color.a),
  );
}
`;
}

/** Unlit line and point selection output used by the visible depth/stencil pass. */
export const selectionFragmentShader = visibleSelectionFragment(false);

/** Lit triangle selection output preserving the model's surface shape. */
export const triangleSelectionFragmentShader = visibleSelectionFragment(true);

/** Fixed-alpha hidden selection output for line and point primitives. */
export const selectionTransparencyFragmentShader = /* wgsl */ `
${transparencyOutput}
${selectionColorFunction}
${sectionPlaneBindings}
${sectionPlaneFunction}

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
  if (selected == 0u || dot(local, local) > 1.0 || !sectionPlaneVisible(worldPosition)) { discard; }
  return weightedPresentationTransparency(
    selectionColor(color, emissive),
    0.25,
  );
}
`;
