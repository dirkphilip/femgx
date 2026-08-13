import { emphasisHash } from "./gpu-highlight-shader";

/**
 * Shared WGSL for the instanced render passes. All vertex shaders read the
 * same camera and deformation uniforms and per-part instance storage, so parts
 * can mix triangle, line, and point-sprite primitives within one frame.
 * Every vertex shader reads the per-vertex node pick ids so displacement maps
 * vertices back to their FE nodes (see `displacementFn`); triangle geometry
 * additionally reads the per-triangle element and face/body visibility ids plus the
 * runtime-sized emphasis records, so body, element, and face emphasis can
 * override the resolved instance color. The node-overlay point sprites read
 * the same records for body and node emphasis. The
 * triangle pick pass lives in `gpu-node-pick.ts` so it can also report the
 * nearest node.
 */

/** Camera uniform: view projection, viewport, clip planes, and key light. */
export const cameraStruct = /* wgsl */ `
struct Camera {
  viewProjection: mat4x4<f32>,
  viewport: vec2<f32>,
  pointSize: f32,
  nearPlane: f32,
  farPlane: f32,
  ortho: f32,
  depthSlack: f32,
  _pad: f32,
  keyLightDirection: vec4<f32>,
  viewDirection: vec4<f32>,
};
`;

/** Per-frame deformation uniform: displacement scale plus the active load case. */
export const deformationStruct = /* wgsl */ `
struct Deformation {
  scale: f32,
  loadCase: u32,
  loadCaseCount: u32,
  _padding: u32,
};
`;

/** Instance storage layout shared by every vertex shader. */
export const instanceStruct = /* wgsl */ `
// Field layout (byte offsets) must match encodeInstanceRecord in gpu-draw.ts:
// transform 0, color 64, pickId 80, emissive 84, selected 88, padding 92.
struct Instance {
  transform: mat4x4<f32>,
  color: vec4<f32>,
  pickId: u32,
  emissive: f32,
  selected: u32,
  _padding: u32,
};
`;

/** Emphasis records read by the visible triangle and point vertex stages. */
export const emphasisStructs = /* wgsl */ `
// Field layout must match encodeEmphasisRecord in gpu-elements.ts:
// slot 0, elementPickId 4, facePickId 8, nodePickId 12, color 16, emissive 32,
// hidden 36, selected 40.
// The struct has no trailing member so its size stays 48 bytes (vec3 members
// would force 16-byte alignment and a 64-byte stride that would not match the
// encoder).
struct ElementHighlight {
  slot: u32,
  elementPickId: u32,
  facePickId: u32,
  nodePickId: u32,
  color: vec4<f32>,
  emissive: f32,
  hidden: u32,
  selected: u32,
};

// records starts at byte offset 16 to keep the 16-byte element alignment;
// matches HIGHLIGHT_HEADER in gpu-elements.ts. The header padding is a plain
// array so it stays 4-byte aligned (a vec3 would move records to offset 32).
// records is a runtime-sized array of four-entry buckets. The CPU chooses a
// deterministic seed so each emphasis lookup probes one bounded bucket instead
// of scanning every emphasized record (see wiki/element-interaction.md).
struct ElementHighlights {
  count: u32,
  bucketCount: u32,
  seed: u32,
  _padding: u32,
  records: array<ElementHighlight>,
};
`;

/** Frame-uniform binding layout shared by every vertex shader. */
export const frameBindings = /* wgsl */ `
@group(0) @binding(0) var<uniform> camera: Camera;
@group(0) @binding(1) var<uniform> deformation: Deformation;
`;

/** Instance storage binding layout shared by every vertex shader. */
export const instanceBindings = /* wgsl */ `
@group(1) @binding(0) var<storage, read> instances: array<Instance>;
@group(1) @binding(1) var<storage, read> drawOrder: array<u32>;
@group(1) @binding(4) var<storage, read> displacements: array<f32>;
@group(1) @binding(6) var<storage, read> vertexNodePickIds: array<u32>;
`;

/** Per-primitive and per-vertex pick data bindings used by draw stages. */
export const pickDataBindings = /* wgsl */ `
@group(1) @binding(2) var<storage, read> primitiveElementPickIds: array<u32>;
@group(1) @binding(3) var<storage, read> elementHighlights: ElementHighlights;
// Packed header: face-record count, topology range count, then face/owner/
// neighbor records, topology ranges, and topology owner/neighbor ids.
@group(1) @binding(5) var<storage, read> topologyData: array<u32>;

fn primitiveFaceBodyPickIds(index: u32) -> vec3<u32> {
  let base = 2u + index * 3u;
  return vec3<u32>(topologyData[base], topologyData[base + 1u], topologyData[base + 2u]);
}

fn topologyBodyRange(index: u32) -> vec2<u32> {
  let base = 2u + topologyData[0] * 3u + index * 2u;
  return vec2<u32>(topologyData[base], topologyData[base + 1u]);
}

fn topologyBodyId(index: u32) -> u32 {
  let base = 2u + topologyData[0] * 3u + topologyData[1] * 2u;
  return topologyData[base + index * 2u];
}

fn topologyBodyNeighborId(index: u32) -> u32 {
  let base = 2u + topologyData[0] * 3u + topologyData[1] * 2u;
  return topologyData[base + index * 2u + 1u];
}

fn bodyOwnerVisible(slot: u32, bodyPickId: u32) -> bool {
  if (bodyPickId == 0u || elementHighlights.bucketCount == 0u) {
    return true;
  }
  let bucket = highlightHash(slot, bodyPickId, 0xffffffffu, 0u, elementHighlights.seed) & (elementHighlights.bucketCount - 1u);
  let base = bucket * 4u;
  for (var offset = 0u; offset < 4u; offset++) {
    let highlight = elementHighlights.records[base + offset];
    if (highlight.slot == slot && highlight.elementPickId == bodyPickId && highlight.facePickId == 0xffffffffu) {
      return highlight.hidden == 0u;
    }
  }
  return true;
}

fn primitiveVisible(slot: u32, primitiveIndex: u32) -> bool {
  let ids = primitiveFaceBodyPickIds(primitiveIndex);
  return bodyOwnerVisible(slot, ids.y) && (ids.z == 0u || !bodyOwnerVisible(slot, ids.z));
}

fn topologyOwnersVisible(slot: u32, topologyIndex: u32) -> bool {
  let range = topologyBodyRange(topologyIndex);
  if (range.y == 0u) {
    return true;
  }
  for (var condition = 0u; condition < range.y; condition++) {
    let owner = topologyBodyId(range.x + condition);
    let neighbor = topologyBodyNeighborId(range.x + condition);
    if (bodyOwnerVisible(slot, owner) && (neighbor == 0u || !bodyOwnerVisible(slot, neighbor))) {
      return true;
    }
  }
  return false;
}
`;

/** Shared packed geometry data: float position bits followed by edge metadata. */
export const geometryDataBindings = /* wgsl */ `
@group(1) @binding(7) var<storage, read> geometryData: array<u32>;

fn geometryPosition(index: u32) -> f32 {
  return bitcast<f32>(geometryData[1u + index]);
}

fn edgeEndpoint(index: u32) -> vec2<u32> {
  let base = 1u + geometryData[0] + index * 2u;
  return vec2<u32>(geometryData[base], geometryData[base + 1u]);
}
`;

/** Shared four-corner lookup for visible and node-pick point sprites. */
export const spriteCornerFn = /* wgsl */ `
fn spriteCorner(corner: u32) -> vec2<f32> {
  switch corner {
    case 0u: { return vec2<f32>(-1.0, -1.0); }
    case 1u: { return vec2<f32>(1.0, -1.0); }
    case 2u: { return vec2<f32>(1.0, 1.0); }
    default: { return vec2<f32>(-1.0, 1.0); }
  }
}
`;

/**
 * Displaces a model-space vertex by the active load case's nodal displacement,
 * scaled by the deformation uniform. Each vertex is mapped to the model node
 * it came from through the per-vertex `vertexNodePickIds` storage buffer
 * (`nodeId + 1`, `0` = vertex without a node), so tessellated
 * geometry that duplicates vertices per triangle/segment deforms like its FE
 * nodes rather than assuming `vertexIndex == nodeIndex`. The `displacements`
 * buffer is indexed by node id. Vertices without a node, whose node id falls
 * outside the buffer, or under a disabled deformation uniform stay in place.
 */
export const displacementFn = /* wgsl */ `
fn displaced(position: vec3<f32>, vertexIndex: u32) -> vec3<f32> {
  if (deformation.loadCaseCount == 0u) {
    return position;
  }
  let nodeCount = arrayLength(&displacements) / (3u * deformation.loadCaseCount);
  if (nodeCount == 0u) {
    return position;
  }
  let nodePickId = vertexNodePickIds[vertexIndex];
  if (nodePickId == 0u || nodePickId > nodeCount) {
    return position;
  }
  let base = (deformation.loadCase * nodeCount + nodePickId - 1u) * 3u;
  let delta = vec3<f32>(displacements[base], displacements[base + 1u], displacements[base + 2u]);
  return position + delta * deformation.scale;
}
`;

/** Shared vertex output for the color and picking fragment stages. */
export const vertexOutput = /* wgsl */ `
struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) @interpolate(flat) color: vec4<f32>,
  @location(1) @interpolate(flat) pickId: u32,
  @location(2) @interpolate(flat) emissive: f32,
  @location(3) @interpolate(flat) elementPickId: u32,
  @location(4) @interpolate(flat) facePickId: u32,
  @location(5) local: vec2<f32>,
  @location(6) @interpolate(flat) centerPixel: vec2<f32>,
  @location(7) @interpolate(flat) nodeDepth: f32,
  @location(8) worldPosition: vec3<f32>,
  @location(9) @interpolate(flat) selected: u32,
};
`;

/** Shared scale-robust two-sided surface lighting for opaque and transparent triangles. */
export const surfaceLightingFunction = /* wgsl */ `
const SURFACE_AMBIENT: f32 = 0.55;
const SURFACE_DIFFUSE: f32 = 0.35;
const SURFACE_SPECULAR_STRENGTH: f32 = 0.14;
const SURFACE_SPECULAR_EXPONENT: f32 = 48.0;

fn finiteDerivativeNormal(first: vec3<f32>, second: vec3<f32>) -> vec3<f32> {
  let firstScale = max(max(abs(first.x), abs(first.y)), abs(first.z));
  let secondScale = max(max(abs(second.x), abs(second.y)), abs(second.z));
  // The upper guard is the f32 representable limit, not a scene-scale cutoff.
  if (firstScale != firstScale || secondScale != secondScale ||
      firstScale <= 0.0 || secondScale <= 0.0 ||
      firstScale >= 3.402823466e38 || secondScale >= 3.402823466e38) {
    return vec3<f32>(0.0);
  }
  let normalizedFirst = first / firstScale;
  let normalizedSecond = second / secondScale;
  let geometricNormal = cross(normalizedFirst, normalizedSecond);
  let normalLength = length(geometricNormal);
  if (normalLength != normalLength || normalLength <= 1e-6) {
    return vec3<f32>(0.0);
  }
  return geometricNormal / normalLength;
}

fn safeDirection(direction: vec3<f32>) -> vec3<f32> {
  let directionLength = length(direction);
  if (directionLength != directionLength || directionLength <= 1e-6 ||
      directionLength >= 3.402823466e38) {
    return vec3<f32>(0.0);
  }
  return direction / directionLength;
}

fn surfaceLighting(
  worldPosition: vec3<f32>,
  baseColor: vec3<f32>,
  keyLightDirection: vec3<f32>,
  viewDirection: vec3<f32>,
) -> vec3<f32> {
  let normal = finiteDerivativeNormal(dpdx(worldPosition), dpdy(worldPosition));
  let normalLength = length(normal);
  if (normalLength <= 0.0) {
    return baseColor * SURFACE_AMBIENT;
  }
  let light = safeDirection(keyLightDirection);
  let viewer = safeDirection(viewDirection);
  let keyResponse = abs(dot(normal, light));
  let diffuse = SURFACE_AMBIENT + SURFACE_DIFFUSE * clamp(keyResponse, 0.0, 1.0);
  let halfVector = safeDirection(light + viewer);
  let halfResponse = abs(dot(normal, halfVector));
  let specular = select(
    0.0,
    SURFACE_SPECULAR_STRENGTH * pow(clamp(halfResponse, 0.0, 1.0), SURFACE_SPECULAR_EXPONENT),
    length(halfVector) > 0.0,
  );
  return baseColor * diffuse + vec3<f32>(specular);
}
`;

/** Packs a u32 pick id into the four RGBA bytes of an `rgba8unorm` target. */
export const packPickIdFunction = /* wgsl */ `
fn packPickId(pickId: u32) -> vec4<f32> {
  return vec4<f32>(
    f32(pickId & 0xFFu) / 255.0,
    f32((pickId >> 8u) & 0xFFu) / 255.0,
    f32((pickId >> 16u) & 0xFFu) / 255.0,
    f32((pickId >> 24u) & 0xFFu) / 255.0,
  );
}
`;

/** Fragment stage for the visible color pass; emissive adds a white glow. */
export const colorFragmentShader = /* wgsl */ `
@fragment
fn fragmentMain(@location(0) @interpolate(flat) color: vec4<f32>, @location(2) @interpolate(flat) emissive: f32, @location(5) local: vec2<f32>) -> @location(0) vec4<f32> {
  if (dot(local, local) > 1.0 || color.a < 1.0) { discard; }
  return vec4<f32>(color.rgb + vec3<f32>(emissive), color.a);
}
`;

/** Lit triangle fragment stage; overlays, lines, and points remain unlit. */
export const triangleColorFragmentShader = /* wgsl */ `
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
) -> @location(0) vec4<f32> {
  if (dot(local, local) > 1.0 || color.a < 1.0) { discard; }
  let litColor = surfaceLighting(
    worldPosition,
    color.rgb,
    camera.keyLightDirection.xyz,
    camera.viewDirection.xyz,
  );
  return vec4<f32>(litColor + vec3<f32>(emissive), color.a);
}
`;

/** Edge color pass with the minimum depth24 offset needed for coplanar lines. */
export const edgeFragmentShader = /* wgsl */ `
struct EdgeFragmentOutput {
  @location(0) color: vec4<f32>,
  @builtin(frag_depth) depth: f32,
};

@fragment
fn fragmentMain(
  @builtin(position) fragmentPosition: vec4<f32>,
  @location(0) color: vec4<f32>,
  @location(2) @interpolate(flat) emissive: f32,
) -> EdgeFragmentOutput {
  var output: EdgeFragmentOutput;
  output.color = vec4<f32>(color.rgb + vec3<f32>(emissive), color.a);
  output.depth = max(fragmentPosition.z - 1.0 / 16777215.0, 0.0);
  return output;
}
`;

/**
 * Vertex stage for the wireframe/edge display pass. It draws the deduplicated
 * mesh edges as a neutral black line list above the solid surface.
 */
export const edgeVertexShader = /* wgsl */ `
${cameraStruct}

${deformationStruct}

${instanceStruct}

${emphasisStructs}
${emphasisHash}

${frameBindings}
${instanceBindings}
${pickDataBindings}
${geometryDataBindings}

${displacementFn}

struct EdgeOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec4<f32>,
  @location(2) @interpolate(flat) emissive: f32,
  @location(5) local: vec2<f32>,
};

@vertex
fn vertexMain(
  @location(0) position: vec3<f32>,
  @builtin(instance_index) instanceIndex: u32,
  @builtin(vertex_index) vertexIndex: u32,
) -> EdgeOutput {
  let slot = drawOrder[instanceIndex];
  let instance = instances[slot];
  let endpoint = edgeEndpoint(vertexIndex);
  let sourceVertexIndex = endpoint.x;
  let topologyIndex = endpoint.y;
  var output: EdgeOutput;
  output.position = camera.viewProjection * instance.transform * vec4<f32>(displaced(position, sourceVertexIndex), 1.0);
  if (!topologyOwnersVisible(slot, topologyIndex)) {
    output.position = vec4<f32>(2.0, 2.0, 2.0, 1.0);
  }
  output.color = vec4<f32>(0.0, 0.0, 0.0, 0.45 * instance.color.a);
  output.emissive = 0.0;
  output.local = vec2<f32>(0.0);
  return output;
}
`;
