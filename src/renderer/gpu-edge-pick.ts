import {
  cameraStruct,
  deformationStruct,
  displacementFn,
  emphasisStructs,
  frameBindings,
  geometryPositionBindings,
  instanceBindings,
  instanceStruct,
  lineExpansionFn,
  packPickIdFunction,
  pickDataBindings,
  sectionPlaneBindings,
  sectionPlaneFunction,
} from "./gpu-shaders";
import { emphasisHash } from "./gpu-highlight-shader";

/** Vertex stage for the lazy, screen-space-width authored-edge pick pass. */
export const edgePickVertexShader = /* wgsl */ `
${cameraStruct}
${deformationStruct}
${instanceStruct}
${emphasisStructs}
${emphasisHash}
${frameBindings}
${instanceBindings}
${pickDataBindings}
${geometryPositionBindings}
${displacementFn}
${lineExpansionFn}

struct EdgePickOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) @interpolate(flat) edgePickId: u32,
  @location(1) worldPosition: vec3<f32>,
};

@vertex
fn vertexMain(
  @location(0) position: vec3<f32>,
  @builtin(instance_index) instanceIndex: u32,
  @builtin(vertex_index) vertexIndex: u32,
) -> EdgePickOutput {
  let slot = drawOrder[instanceIndex];
  let instance = instances[slot];
  let lineBase = vertexIndex - (vertexIndex % 4u);
  let lineA = vec3<f32>(
    geometryPosition(lineBase * 3u),
    geometryPosition(lineBase * 3u + 1u),
    geometryPosition(lineBase * 3u + 2u),
  );
  let lineB = vec3<f32>(
    geometryPosition((lineBase + 1u) * 3u),
    geometryPosition((lineBase + 1u) * 3u + 1u),
    geometryPosition((lineBase + 1u) * 3u + 2u),
  );
  let clipA = camera.viewProjection * instance.transform * vec4<f32>(displaced(lineA, lineBase), 1.0);
  let clipB = camera.viewProjection * instance.transform * vec4<f32>(displaced(lineB, lineBase + 1u), 1.0);
  var output: EdgePickOutput;
  output.position = lineExpandedPosition(
    clipA,
    clipB,
    vertexIndex % 4u,
    camera.linePickSize * camera.devicePixelRatio,
  );
  if (!topologyAnyOwnerVisible(slot, edgeId(vertexIndex))) {
    output.position = vec4<f32>(2.0, 2.0, 2.0, 1.0);
  }
  output.edgePickId = edgeId(vertexIndex) + 1u;
  output.worldPosition = (instance.transform * vec4<f32>(displaced(position, vertexIndex), 1.0)).xyz;
  return output;
}
`;

/** Fragment stage encoding one private authored-edge id. */
export const edgePickFragmentShader = /* wgsl */ `
${sectionPlaneBindings}
${sectionPlaneFunction}
${packPickIdFunction}

@fragment
fn fragmentMain(
  @location(0) @interpolate(flat) edgePickId: u32,
  @location(1) worldPosition: vec3<f32>,
) -> @location(0) vec4<f32> {
  if (!sectionPlaneVisible(worldPosition)) { discard; }
  return packPickId(edgePickId);
}
`;
