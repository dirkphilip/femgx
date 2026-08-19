import {
  INSTANCE_EDGE_EMPHASIS_FLAG,
  INSTANCE_EMPHASIS_FLAG,
  INSTANCE_SELECTED_FLAG,
} from "../resources/instance-storage";
export { emphasisStructs } from "./emphasis";
export {
  colorFragmentShader,
  edgeFragmentShader,
  sectionPlaneBindings,
  sectionPlaneFunction,
  sectionPlaneStruct,
} from "./fragment";
import { sectionPlaneBindings, sectionPlaneFunction } from "./fragment";
export { pickDataBindings } from "./topology";

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
 * triangle pick pass lives in `picking/node-pick.ts` so it can also report the
 * nearest node.
 */

/** Camera uniform: view projection, fixed-size presentation, and key light. */
export const cameraStruct = /* wgsl */ `
struct Camera {
  viewProjection: mat4x4<f32>,
  viewport: vec2<f32>,
  pointSize: f32,
  nodeSize: f32,
  devicePixelRatio: f32,
  linePickSize: f32,
  trianglePickSize: f32,
  keyLightDirection: vec4<f32>,
  viewDirection: vec4<f32>,
};
`;

/** Per-frame deformation uniform: displacement scale plus explicit alignment padding. */
export const deformationStruct = /* wgsl */ `
struct Deformation {
  scale: f32,
  _padding0: u32,
  _padding1: u32,
  _padding2: u32,
};
`;

/** Instance storage layout shared by every vertex shader. */
export const instanceStruct = /* wgsl */ `
// Field layout (byte offsets) must match encodeInstanceRecord in resources/instance-record.ts:
// transform 0, color 64, pickId 80, emissive 84, selected/emphasis flags 88,
// lineWidth 92.
struct Instance {
  transform: mat4x4<f32>,
  color: vec4<f32>,
  pickId: u32,
  emissive: f32,
  selected: u32,
  lineWidth: f32,
};

fn instanceSelected(flags: u32) -> bool {
  return (flags & ${INSTANCE_SELECTED_FLAG}u) != 0u;
}

fn instanceHasPrimitiveEmphasis(flags: u32) -> bool {
  return (flags & ${INSTANCE_EMPHASIS_FLAG}u) != 0u;
}

fn instanceHasEdgeEmphasis(flags: u32) -> bool {
  return (flags & ${INSTANCE_EDGE_EMPHASIS_FLAG}u) != 0u;
}

`;

/** Emphasis records read by the visible triangle and point vertex stages. */
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

/** Shared lookup for renderer-owned dense nodal or elemental scalar colors. */
export const resultColorFunctions = /* wgsl */ `
@group(1) @binding(8) var<storage, read> resultColors: array<f32>;

fn resultColorKey(nodePickId: u32, elementOrdinal: u32) -> u32 {
  return select(nodePickId, elementOrdinal, resultColors[0] == 1.0);
}

fn resultColorActive(nodePickId: u32, elementOrdinal: u32) -> bool {
  let key = resultColorKey(nodePickId, elementOrdinal);
  return resultColors[0] >= 0.0 && key != 0u && key < u32(resultColors[1]);
}

fn resultColorFor(nodePickId: u32, elementOrdinal: u32, fallback: vec4<f32>) -> vec4<f32> {
  if (!resultColorActive(nodePickId, elementOrdinal)) { return fallback; }
  let base = 4u + resultColorKey(nodePickId, elementOrdinal) * 4u;
  return vec4<f32>(
    resultColors[base],
    resultColors[base + 1u],
    resultColors[base + 2u],
    resultColors[base + 3u] * fallback.a,
  );
}
`;

/** Shared geometry position buffer and topology-backed primitive lookup. */
export const geometryPositionBindings = /* wgsl */ `
@group(1) @binding(7) var<storage, read> geometryPositions: array<f32>;

fn geometryPosition(index: u32) -> f32 {
  return geometryPositions[index];
}

fn geometryPositionVec(index: u32) -> vec3<f32> {
  let base = index * 3u;
  return vec3<f32>(geometryPositions[base], geometryPositions[base + 1u], geometryPositions[base + 2u]);
}

fn geometrySourceIndex(index: u32) -> u32 {
  let primitiveBase = topologyConditionBase() + topologyConditionCount() * 4u + topologyData[3];
  let cornerBase = primitiveBase + 1u + topologyData[primitiveBase];
  return topologyData[cornerBase + index];
}

fn primitiveDrawId(index: u32) -> u32 {
  return topologyPrimitiveId(index);
}

fn edgeId(index: u32) -> u32 {
  return topologyEdgeId(index);
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

/** Shared screen-space expansion for authored line triangle quads. */
export const lineExpansionFn = /* wgsl */ `
fn lineExpandedPosition(
  clipA: vec4<f32>,
  clipB: vec4<f32>,
  corner: u32,
  widthPixels: f32,
) -> vec4<f32> {
  if (camera.viewport.x <= 0.0 || camera.viewport.y <= 0.0 ||
      clipA.w <= 1e-5 || clipB.w <= 1e-5) {
    return vec4<f32>(2.0, 2.0, 2.0, 1.0);
  }
  let ndcA = clipA.xy / clipA.w;
  let ndcB = clipB.xy / clipB.w;
  let screenA = ndcA * camera.viewport * 0.5;
  let screenB = ndcB * camera.viewport * 0.5;
  let delta = screenB - screenA;
  let lengthDelta = length(delta);
  if (lengthDelta != lengthDelta || lengthDelta <= 1e-5) {
    return vec4<f32>(2.0, 2.0, 2.0, 1.0);
  }
  let direction = delta / lengthDelta;
  let normal = vec2<f32>(-direction.y, direction.x);
  let halfWidth = max(widthPixels, 0.5) * 0.5;
  let isB = corner == 1u || corner == 2u;
  let isPositiveSide = corner >= 2u;
  let center = select(screenA, screenB, isB);
  let cap = direction * halfWidth * select(-1.0, 1.0, isB);
  let side = normal * halfWidth * select(-1.0, 1.0, isPositiveSide);
  let pixelPosition = center + cap + side;
  let pixelOffset = pixelPosition - center;
  let clip = select(clipA, clipB, isB);
  let ndcOffset = pixelOffset * 2.0 / camera.viewport;
  return vec4<f32>(clip.xy + ndcOffset * clip.w, clip.z, clip.w);
}
`;

/** Expands only subpixel triangles in pick/selection passes to a bounded footprint. */
export const trianglePickExpansionFn = /* wgsl */ `
fn trianglePickPosition(
  clipA: vec4<f32>,
  clipB: vec4<f32>,
  clipC: vec4<f32>,
  centerClip: vec4<f32>,
  corner: u32,
) -> vec4<f32> {
  if (camera.viewport.x <= 0.0 || camera.viewport.y <= 0.0 ||
      clipA.w <= 1e-5 || clipB.w <= 1e-5 || clipC.w <= 1e-5 ||
      camera.trianglePickSize <= 0.0) {
    switch corner {
      case 0u: { return clipA; }
      case 1u: { return clipB; }
      default: { return clipC; }
    }
  }
  let screenA = (clipA.xy / clipA.w) * camera.viewport * 0.5;
  let screenB = (clipB.xy / clipB.w) * camera.viewport * 0.5;
  let screenC = (clipC.xy / clipC.w) * camera.viewport * 0.5;
  let span = max(
    max(length(screenA - screenB), length(screenB - screenC)),
    length(screenC - screenA),
  );
  let area = abs(
    (screenB.x - screenA.x) * (screenC.y - screenA.y) -
    (screenB.y - screenA.y) * (screenC.x - screenA.x),
  ) * 0.5;
  if (span >= camera.trianglePickSize && area >= 1.0) {
    switch corner {
      case 0u: { return clipA; }
      case 1u: { return clipB; }
      default: { return clipC; }
    }
  }
  if (centerClip.w <= 1e-5) {
    return centerClip;
  }
  let radius = camera.trianglePickSize * 0.5;
  var offset = vec2<f32>(0.0, radius);
  switch corner {
    case 0u: { offset = vec2<f32>(-radius, -radius * 0.5); }
    case 1u: { offset = vec2<f32>(radius, -radius * 0.5); }
    default: {}
  }
  let ndcOffset = offset * 2.0 / camera.viewport;
  return vec4<f32>(
    centerClip.xy + ndcOffset * centerClip.w,
    centerClip.z,
    centerClip.w,
  );
}
`;

/**
 * Displaces a model-space vertex by the authored nodal displacement,
 * scaled by the deformation uniform. Each vertex is mapped to the model node
 * it came from through the per-vertex `vertexNodePickIds` storage buffer
 * (`nodeId + 1`, `0` = vertex without a node), so indexed tessellated
 * geometry deforms through its FE nodes instead of assuming
 * `vertexIndex == nodeIndex`. Custom geometry may duplicate a source node at
 * multiple output vertices. The `displacements`
 * buffer is indexed by node id. Vertices without a node, whose node id falls
 * outside the buffer, or under a disabled deformation uniform stay in place.
 */
export const displacementFn = /* wgsl */ `
fn displaced(position: vec3<f32>, vertexIndex: u32) -> vec3<f32> {
  let displacementCount = arrayLength(&displacements);
  if (displacementCount == 0u) {
    return position;
  }
  let nodeCount = displacementCount / 3u;
  if (nodeCount == 0u) {
    return position;
  }
  let nodePickId = vertexNodePickIds[vertexIndex];
  if (nodePickId == 0u || nodePickId > nodeCount) {
    return position;
  }
  let base = (nodePickId - 1u) * 3u;
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
  @location(10) resultColor: vec4<f32>,
  @location(11) @interpolate(flat) resultColorEnabled: u32,
};
`;

/** Shared scale-robust view-facing surface lighting for opaque and transparent triangles. */
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
  let facingNormal = select(-normal, normal, dot(normal, viewer) >= 0.0);
  let keyResponse = clamp(dot(facingNormal, light), 0.0, 1.0);
  let diffuse = SURFACE_AMBIENT + SURFACE_DIFFUSE * keyResponse;
  let halfVector = safeDirection(light + viewer);
  let halfResponse = dot(facingNormal, halfVector);
  let specular = select(
    0.0,
    SURFACE_SPECULAR_STRENGTH * pow(clamp(halfResponse, 0.0, 1.0), SURFACE_SPECULAR_EXPONENT),
    keyResponse > 0.0 && length(halfVector) > 0.0,
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

/** Lit triangle fragment stage using exact fixed-function surface depth. */
export const triangleColorFragmentShader = /* wgsl */ `
${cameraStruct}
${deformationStruct}
${frameBindings}
${sectionPlaneBindings}
${sectionPlaneFunction}
${surfaceLightingFunction}

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
  let displayedColor = select(color, resultColor, resultColorEnabled != 0u);
  if (dot(local, local) > 1.0 || displayedColor.a < 1.0 || !sectionPlaneVisible(worldPosition)) { discard; }
  let litColor = surfaceLighting(
    worldPosition,
    displayedColor.rgb,
    camera.keyLightDirection.xyz,
    camera.viewDirection.xyz,
  );
  let resolvedColor = select(litColor, displayedColor.rgb, selected != 0u);
  return vec4<f32>(resolvedColor + vec3<f32>(emissive), displayedColor.a);
}
`;
