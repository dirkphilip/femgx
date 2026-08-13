import {
  cameraStruct,
  deformationStruct,
  displacementFn,
  emphasisStructs,
  frameBindings,
  geometryPositionBindings,
  instanceBindings,
  instanceStruct,
  packPickIdFunction,
  pickDataBindings,
  spriteCornerFn,
} from "./gpu-shaders";
import { emphasisHash } from "./gpu-highlight-shader";

/**
 * Element/node pick pass shaders. In addition to the instance, element, and
 * face pick ids they pass primitive corner positions and node pick ids as flat
 * varyings plus the interpolated local position, so the fragment stage can
 * report a nearby node. Hits farther from every corner write node id 0 so
 * The physical hit resolver falls through to face/element. Corner and local
 * positions are displaced by the deformation state so node picking stays
 * consistent on deformed shapes.
 */

interface NodePickPrimitiveVariant {
  readonly verticesPerPrimitive: 2 | 3;
  readonly cornerC: "second" | "third";
}

const nodePickVertexHeader = /* wgsl */ `
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
`;

/** Builds the triangle or line node-pick vertex stage from explicit topology inputs. */
function createNodePickVertexShader(variant: NodePickPrimitiveVariant): string {
  const primitiveIndex = "primitiveDrawId(vertexIndex)";
  const primitiveBase = `(vertexIndex - (vertexIndex % ${variant.verticesPerPrimitive}u))`;
  const cornerC = cornerData(variant);
  const nodePickIds = variant.cornerC === "third" ? "vertexNodePickIds[base + 2u]" : "0u";
  return `${nodePickVertexHeader}${createNodePickVertexMain({
    primitiveIndex,
    primitiveBase,
    cornerC,
    nodePickIds,
  })}`;
}

interface NodePickVertexMainOptions {
  readonly primitiveIndex: string;
  readonly primitiveBase: string;
  readonly cornerC: string;
  readonly nodePickIds: string;
}

function createNodePickVertexMain(options: NodePickVertexMainOptions): string {
  return /* wgsl */ `
@vertex
fn vertexMain(
  @location(0) position: vec3<f32>,
  @builtin(instance_index) instanceIndex: u32,
  @builtin(vertex_index) vertexIndex: u32,
) -> NodeVertexOutput {
  let instance = instances[drawOrder[instanceIndex]];
  let base = ${options.primitiveBase};
  let base3 = base * 3u;
  let faceBodyPickIds = primitiveFaceBodyPickIds(${options.primitiveIndex});
${createNodePickVertexOutput(options)}
}
`;
}

function createNodePickVertexOutput(options: NodePickVertexMainOptions): string {
  return /* wgsl */ `
  var output: NodeVertexOutput;
  output.position = camera.viewProjection * instance.transform * vec4<f32>(displaced(position, vertexIndex), 1.0);
  if (!primitiveVisible(drawOrder[instanceIndex], ${options.primitiveIndex})) {
    output.position = vec4<f32>(2.0, 2.0, 2.0, 1.0);
  }
  output.color = instance.color;
  output.pickId = instance.pickId;
  output.emissive = instance.emissive;
  output.elementPickId = primitiveElementPickIds[${options.primitiveIndex}];
  output.facePickId = faceBodyPickIds.x;
  output.localPosition = displaced(position, vertexIndex);
  output.cornerA = displaced(
    vec3<f32>(
      geometryPosition(base3),
      geometryPosition(base3 + 1u),
      geometryPosition(base3 + 2u),
    ),
    base,
  );
  output.cornerB = displaced(
    vec3<f32>(
      geometryPosition(base3 + 3u),
      geometryPosition(base3 + 4u),
      geometryPosition(base3 + 5u),
    ),
    base + 1u,
  );
  output.cornerC = displaced(
    ${options.cornerC},
  );
  output.nodePickIds = vec3<u32>(
    vertexNodePickIds[base],
    vertexNodePickIds[base + 1u],
    ${options.nodePickIds},
  );
  return output;
`;
}

function cornerData(variant: NodePickPrimitiveVariant): string {
  const base = variant.cornerC === "third" ? 6 : 3;
  const nodeOffset = variant.cornerC === "third" ? 2 : 1;
  return `vec3<f32>(
    geometryPosition(base3 + ${base}u),
    geometryPosition(base3 + ${base + 1}u),
    geometryPosition(base3 + ${base + 2}u),
  ),
  base + ${nodeOffset}u`;
}

export const nodePickVertexShader = createNodePickVertexShader({
  verticesPerPrimitive: 3,
  cornerC: "third",
});

/** Line-list node-pick vertex stage using two corners per logical primitive. */
export const lineNodePickVertexShader = createNodePickVertexShader({
  verticesPerPrimitive: 2,
  cornerC: "second",
});

/** Point-sprite node-pick vertex stage; every sprite fragment belongs to its node. */
export const pointNodePickVertexShader = /* wgsl */ `
${cameraStruct}

${deformationStruct}

${instanceStruct}

${emphasisStructs}
${emphasisHash}

${frameBindings}
${instanceBindings}
${pickDataBindings}

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

${spriteCornerFn}

@vertex
fn pointVertexMain(
  @location(0) position: vec3<f32>,
  @builtin(instance_index) instanceIndex: u32,
  @builtin(vertex_index) vertexIndex: u32,
) -> NodeVertexOutput {
  let instance = instances[drawOrder[instanceIndex]];
  let center = displaced(position, vertexIndex);
  let clip = camera.viewProjection * instance.transform * vec4<f32>(center, 1.0);
  let corner = spriteCorner(vertexIndex % 4u);
  let offset = (corner * camera.pointSize) / camera.viewport;
  let elementPickId = primitiveElementPickIds[vertexIndex / 4u];
  var output: NodeVertexOutput;
  output.position = vec4<f32>(
    clip.x + offset.x * clip.w,
    clip.y + offset.y * clip.w,
    clip.z,
    clip.w,
  );
  if (!topologyOwnersVisible(drawOrder[instanceIndex], vertexIndex / 4u)) {
    output.position = vec4<f32>(2.0, 2.0, 2.0, 1.0);
  }
  output.color = instance.color;
  output.pickId = instance.pickId;
  output.emissive = instance.emissive;
  output.elementPickId = elementPickId;
  output.facePickId = 0u;
  output.localPosition = center;
  output.cornerA = center;
  output.cornerB = center;
  output.cornerC = center;
  let nodePickId = vertexNodePickIds[vertexIndex];
  output.nodePickIds = vec3<u32>(nodePickId, nodePickId, nodePickId);
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
  // Accept a node only near a corner; otherwise leave node id 0 so face/
  // element resolution can win for face-interior fragments.
  let edgeScale = max(max(distanceSquared(a, b), distanceSquared(b, c)), distanceSquared(c, a));
  let threshold = edgeScale * 0.04;
  if (bestId == 0u || bestDist > threshold) {
    return 0u;
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
