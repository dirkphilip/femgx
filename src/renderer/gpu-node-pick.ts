import {
  cameraStruct,
  deformationStruct,
  displacementFn,
  emphasisStructs,
  frameBindings,
  instanceBindings,
  instanceStruct,
  packPickIdFunction,
  pickDataBindings,
} from "./gpu-shaders";

/**
 * Triangle pick pass shaders. In addition to the instance, element, and face
 * pick ids they pass each triangle's three corner positions and node pick ids
 * as flat varyings plus the interpolated local position, so the fragment stage
 * can report the node id of the corner nearest to the hit. Corner and local
 * positions are displaced by the deformation state so node picking stays
 * consistent on deformed shapes.
 */

/** Vertex stage for the triangle pick pass. */
export const nodePickVertexShader = /* wgsl */ `
${cameraStruct}

${deformationStruct}

${instanceStruct}

${emphasisStructs}

${frameBindings}
${instanceBindings}
${pickDataBindings}
@group(1) @binding(7) var<storage, read> cornerPositions: array<vec3<f32>>;

${displacementFn}

struct NodeVertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec4<f32>,
  @location(1) @interpolate(flat) pickId: u32,
  @location(2) @interpolate(flat) emissive: f32,
  @location(3) @interpolate(flat) elementPickId: u32,
  @location(4) @interpolate(flat) facePickId: u32,
  @location(5) localPosition: vec3<f32>,
  @location(6) @interpolate(flat) cornerA: vec3<f32>,
  @location(7) @interpolate(flat) cornerB: vec3<f32>,
  @location(8) @interpolate(flat) cornerC: vec3<f32>,
  @location(9) @interpolate(flat) nodePickIds: vec3<u32>,
};

@vertex
fn vertexMain(
  @location(0) position: vec3<f32>,
  @builtin(instance_index) instanceIndex: u32,
  @builtin(vertex_index) vertexIndex: u32,
) -> NodeVertexOutput {
  let instance = instances[drawOrder[instanceIndex]];
  let base = (vertexIndex / 3u) * 3u;
  var output: NodeVertexOutput;
  output.position = camera.viewProjection * instance.transform * vec4<f32>(displaced(position, vertexIndex), 1.0);
  output.color = instance.color;
  output.pickId = instance.pickId;
  output.emissive = instance.emissive;
  output.elementPickId = triangleElementPickIds[vertexIndex / 3u];
  output.facePickId = triangleFacePickIds[vertexIndex / 3u];
  output.localPosition = displaced(position, vertexIndex);
  output.cornerA = displaced(cornerPositions[base], base);
  output.cornerB = displaced(cornerPositions[base + 1u], base + 1u);
  output.cornerC = displaced(cornerPositions[base + 2u], base + 2u);
  output.nodePickIds = vec3<u32>(
    vertexNodePickIds[base],
    vertexNodePickIds[base + 1u],
    vertexNodePickIds[base + 2u],
  );
  return output;
}
`;

/** Fragment stage for the triangle pick pass, adding the nearest-node pick id. */
export const nodePickFragmentShader = /* wgsl */ `
${packPickIdFunction}

fn distanceSquared(a: vec3<f32>, b: vec3<f32>) -> f32 {
  let d = a - b;
  return dot(d, d);
}

fn nearestNode(
  local: vec3<f32>,
  a: vec3<f32>,
  b: vec3<f32>,
  c: vec3<f32>,
  ids: vec3<u32>,
) -> u32 {
  var bestId = 0u;
  var bestDist = 1.0e30;
  let distA = distanceSquared(local, a);
  let distB = distanceSquared(local, b);
  let distC = distanceSquared(local, c);
  if (ids.x != 0u && distA < bestDist) {
    bestDist = distA;
    bestId = ids.x;
  }
  if (ids.y != 0u && distB < bestDist) {
    bestDist = distB;
    bestId = ids.y;
  }
  if (ids.z != 0u && distC < bestDist) {
    bestDist = distC;
    bestId = ids.z;
  }
  return bestId;
}

struct PickOutput {
  @location(0) instance: vec4<f32>,
  @location(1) element: vec4<f32>,
  @location(2) face: vec4<f32>,
  @location(3) node: vec4<f32>,
};

@fragment
fn fragmentMain(
  @location(1) @interpolate(flat) pickId: u32,
  @location(3) @interpolate(flat) elementPickId: u32,
  @location(4) @interpolate(flat) facePickId: u32,
  @location(5) localPosition: vec3<f32>,
  @location(6) @interpolate(flat) cornerA: vec3<f32>,
  @location(7) @interpolate(flat) cornerB: vec3<f32>,
  @location(8) @interpolate(flat) cornerC: vec3<f32>,
  @location(9) @interpolate(flat) nodePickIds: vec3<u32>,
) -> PickOutput {
  var output: PickOutput;
  output.instance = packPickId(pickId);
  output.element = packPickId(elementPickId);
  output.face = packPickId(facePickId);
  output.node = packPickId(nearestNode(localPosition, cornerA, cornerB, cornerC, nodePickIds));
  return output;
}
`;
