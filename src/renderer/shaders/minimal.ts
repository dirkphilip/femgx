import { cameraStruct, instanceStruct, surfaceLightingFunction } from "./scene";
import { INSTANCE_EDGE_OVERLAY_FLAG } from "../resources/instance-storage";
import { transparencyOutput } from "../frame/transparency";

/** Camera binding used by the ordinary geometry-only admission path. */
export const minimalFrameBindings = /* wgsl */ `
@group(0) @binding(0) var<uniform> camera: Camera;
`;

/** Instance bindings used when no topology-backed feature is active. */
export const minimalInstanceBindings = /* wgsl */ `
@group(1) @binding(0) var<storage, read> instances: array<Instance>;
@group(1) @binding(1) var<storage, read> drawOrder: array<u32>;
`;

const minimalVertexOutput = /* wgsl */ `
struct MinimalVertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) @interpolate(flat) color: vec4<f32>,
  @location(2) @interpolate(flat) emissive: f32,
  @location(5) local: vec2<f32>,
  @location(8) worldPosition: vec3<f32>,
  @location(12) @interpolate(flat) edgeDepthRadius: f32,
};
`;

/** Minimal triangle vertex stage; optional topology and result storage is absent. */
export const minimalTriangleVertexShader = /* wgsl */ `
${cameraStruct}
${instanceStruct}
${minimalFrameBindings}
${minimalInstanceBindings}
${minimalVertexOutput}

@vertex
fn vertexMain(
  @location(0) position: vec3<f32>,
  @builtin(instance_index) instanceIndex: u32,
) -> MinimalVertexOutput {
  let instance = instances[drawOrder[instanceIndex]];
  let worldPosition = (instance.transform * vec4<f32>(position, 1.0)).xyz;
  var output: MinimalVertexOutput;
  output.position = camera.viewProjection * vec4<f32>(worldPosition, 1.0);
  output.color = instance.color;
  output.emissive = instance.emissive;
  output.local = vec2<f32>(0.0);
  output.worldPosition = worldPosition;
  output.edgeDepthRadius = select(
    0.0,
    instance.lineWidth * camera.devicePixelRatio * 0.70710678,
    (instance.selected & ${INSTANCE_EDGE_OVERLAY_FLAG}u) != 0u,
  );
  return output;
}
`;

/** Minimal lit opaque triangle fragment stage. */
export const minimalTriangleColorFragmentShader = /* wgsl */ `
${cameraStruct}
${minimalFrameBindings}
${surfaceLightingFunction}

struct MinimalTriangleColorOutput {
  @location(0) color: vec4<f32>,
  @builtin(frag_depth) depth: f32,
};

@fragment
fn fragmentMain(
  @builtin(position) fragmentPosition: vec4<f32>,
  @location(0) @interpolate(flat) color: vec4<f32>,
  @location(2) @interpolate(flat) emissive: f32,
  @location(5) local: vec2<f32>,
  @location(8) worldPosition: vec3<f32>,
  @location(12) @interpolate(flat) edgeDepthRadius: f32,
) -> MinimalTriangleColorOutput {
  if (dot(local, local) > 1.0 || color.a < 1.0) { discard; }
  let depthSlope = length(vec2<f32>(
    dpdx(fragmentPosition.z),
    dpdy(fragmentPosition.z),
  ));
  let finiteDepthSlope = select(
    0.0,
    depthSlope,
    depthSlope == depthSlope && depthSlope < 3.402823466e38,
  );
  var output: MinimalTriangleColorOutput;
  output.color = vec4<f32>(
    surfaceLighting(
      worldPosition,
      color.rgb,
      camera.keyLightDirection.xyz,
      camera.viewDirection.xyz,
    ) + vec3<f32>(emissive),
    color.a,
  );
  output.depth = min(fragmentPosition.z + finiteDepthSlope * edgeDepthRadius, 1.0);
  return output;
}
`;

/** Minimal lit weighted-transparency triangle fragment stage. */
export const minimalTriangleTransparencyFragmentShader = /* wgsl */ `
${cameraStruct}
${minimalFrameBindings}
${surfaceLightingFunction}
${transparencyOutput}

@fragment
fn fragmentMain(
  @builtin(position) fragmentPosition: vec4<f32>,
  @location(0) @interpolate(flat) color: vec4<f32>,
  @location(2) @interpolate(flat) emissive: f32,
  @location(5) local: vec2<f32>,
  @location(8) worldPosition: vec3<f32>,
) -> TransparencyOutput {
  if (dot(local, local) > 1.0 || color.a <= 0.0 || color.a >= 1.0) { discard; }
  let litColor = surfaceLighting(
    worldPosition,
    color.rgb,
    camera.keyLightDirection.xyz,
    camera.viewDirection.xyz,
  );
  return weightedSceneTransparency(
    litColor + vec3<f32>(emissive),
    color.a,
    fragmentPosition.z,
  );
}
`;
