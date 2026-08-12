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
// transform 0, color 64, pickId 80, emissive 84, padding 88.
struct Instance {
  transform: mat4x4<f32>,
  color: vec4<f32>,
  pickId: u32,
  emissive: f32,
  _padding: vec2<u32>,
};
`;

/** Emphasis records read by the visible triangle and point vertex stages. */
export const emphasisStructs = /* wgsl */ `
// Field layout must match encodeEmphasisRecord in gpu-elements.ts:
// slot 0, elementPickId 4, facePickId 8, nodePickId 12, color 16, emissive 32,
// hidden 36.
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
  @location(0) color: vec4<f32>,
  @location(1) @interpolate(flat) pickId: u32,
  @location(2) @interpolate(flat) emissive: f32,
  @location(3) @interpolate(flat) elementPickId: u32,
  @location(4) @interpolate(flat) facePickId: u32,
  @location(5) local: vec2<f32>,
  @location(6) @interpolate(flat) centerPixel: vec2<f32>,
  @location(7) @interpolate(flat) nodeDepth: f32,
  @location(8) worldPosition: vec3<f32>,
};
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
fn fragmentMain(@location(0) color: vec4<f32>, @location(2) @interpolate(flat) emissive: f32, @location(5) local: vec2<f32>) -> @location(0) vec4<f32> {
  if (dot(local, local) > 1.0 || color.a < 1.0) { discard; }
  return vec4<f32>(color.rgb + vec3<f32>(emissive), color.a);
}
`;

/** Lit triangle fragment stage; overlays, lines, and points remain unlit. */
export const triangleColorFragmentShader = /* wgsl */ `
${cameraStruct}
${deformationStruct}
${frameBindings}

@fragment
fn fragmentMain(
  @location(0) color: vec4<f32>,
  @location(2) @interpolate(flat) emissive: f32,
  @location(5) local: vec2<f32>,
  @location(8) worldPosition: vec3<f32>,
) -> @location(0) vec4<f32> {
  if (dot(local, local) > 1.0 || color.a < 1.0) { discard; }
  let geometricNormal = cross(dpdx(worldPosition), dpdy(worldPosition));
  let normalLength = length(geometricNormal);
  var diffuse = 0.65;
  // WGSL's finite-value built-in is not available in the browser baseline;
  // NaN is unequal to itself and infinity exceeds this practical bound.
  if (normalLength == normalLength && normalLength > 1e-6 && normalLength < 1e20) {
    let normal = geometricNormal / normalLength;
    let keyResponse = abs(dot(normal, normalize(camera.keyLightDirection.xyz)));
    diffuse = 0.65 + 0.35 * clamp(keyResponse, 0.0, 1.0);
  }
  return vec4<f32>(color.rgb * diffuse + vec3<f32>(emissive), color.a);
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

/**
 * Fragment stage for the picking pass. Packs the u32 pick ids across the four
 * RGBA bytes of an `rgba8unorm` target, mirroring `encodePickId` in
 * `pick-format.ts`; the byte order of both must stay in sync. Target 0 holds
 * the instance pick id, target 1 the element pick id, target 2 the face pick
 * id, and target 3 the node pick id.
 */
export const pickFragmentShader = /* wgsl */ `
${packPickIdFunction}

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
) -> PickOutput {
  var output: PickOutput;
  output.instance = packPickId(pickId);
  output.element = packPickId(elementPickId);
  output.face = packPickId(facePickId);
  output.node = packPickId(0u);
  return output;
}
`;
import { emphasisHash } from "./gpu-highlight-shader";
