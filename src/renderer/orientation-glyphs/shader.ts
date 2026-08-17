import { emphasisHash } from "../shaders/highlight";
import { ownerVisibilityBindings } from "../shaders/topology";
import {
  cameraStruct,
  deformationStruct,
  emphasisStructs,
  frameBindings,
  instanceStruct,
  sectionPlaneBindings,
  sectionPlaneFunction,
} from "../shaders/scene";
import { transparencyOutput } from "../frame/transparency";

const glyphBindings = /* wgsl */ `
struct GlyphRecord {
  anchorLength: vec4<f32>,
  direction: vec4<f32>,
  anchorDelta: vec4<f32>,
  ids: vec4<u32>,
};

struct GlyphNormalMatrix {
  column0: vec4<f32>,
  column1: vec4<f32>,
  column2: vec4<f32>,
};

struct GlyphParams {
  lengthScale: f32,
  mode: u32,
  transformMode: u32,
  widthPixels: f32,
};

@group(2) @binding(0) var<storage, read> glyphRecords: array<GlyphRecord>;
@group(2) @binding(1) var<storage, read> glyphNormalMatrices: array<GlyphNormalMatrix>;
@group(2) @binding(2) var<uniform> glyphParams: GlyphParams;
`;

const glyphVertexShared = /* wgsl */ `
${cameraStruct}
${deformationStruct}
${frameBindings}
${instanceStruct}
${emphasisStructs}
${emphasisHash}
${glyphBindings}

@group(1) @binding(0) var<storage, read> instances: array<Instance>;
@group(1) @binding(1) var<storage, read> drawOrder: array<u32>;
${ownerVisibilityBindings}

struct GlyphVertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) worldPosition: vec3<f32>,
  @location(1) @interpolate(flat) axis: u32,
  @location(2) @interpolate(flat) triad: u32,
};

fn finiteDirection(direction: vec3<f32>) -> vec3<f32> {
  let directionLength = length(direction);
  if (directionLength != directionLength || directionLength <= 1e-6 ||
      directionLength >= 3.402823466e38) {
    return vec3<f32>(0.0);
  }
  return direction / directionLength;
}

fn screenPoint(clip: vec4<f32>) -> vec2<f32> {
  return (clip.xy / clip.w) * camera.viewport * 0.5;
}

fn clipPoint(reference: vec4<f32>, pixel: vec2<f32>) -> vec4<f32> {
  let offset = (pixel - screenPoint(reference)) * 2.0 / camera.viewport;
  return vec4<f32>(reference.xy + offset * reference.w, reference.z, reference.w);
}

fn segmentVertex(
  clipA: vec4<f32>,
  clipB: vec4<f32>,
  corner: u32,
  width: f32,
) -> vec4<f32> {
  if (clipA.w <= 1e-5 || clipB.w <= 1e-5 || camera.viewport.x <= 0.0 || camera.viewport.y <= 0.0) {
    return vec4<f32>(2.0, 2.0, 2.0, 1.0);
  }
  let delta = screenPoint(clipB) - screenPoint(clipA);
  let lengthDelta = length(delta);
  if (lengthDelta != lengthDelta || lengthDelta <= 1e-5) {
    return vec4<f32>(2.0, 2.0, 2.0, 1.0);
  }
  let direction = delta / lengthDelta;
  let normal = vec2<f32>(-direction.y, direction.x);
  let halfWidth = max(width, 0.75 * camera.devicePixelRatio) * 0.5;
  let isB = corner == 1u || corner == 2u;
  let positive = corner >= 2u;
  let center = select(screenPoint(clipA), screenPoint(clipB), isB);
  let cap = direction * halfWidth * select(-1.0, 1.0, isB);
  let side = normal * halfWidth * select(-1.0, 1.0, positive);
  return clipPoint(select(clipA, clipB, isB), center + cap + side);
}

fn arrowHeadVertex(
  clipStart: vec4<f32>,
  clipEnd: vec4<f32>,
  corner: u32,
  width: f32,
) -> vec4<f32> {
  if (clipStart.w <= 1e-5 || clipEnd.w <= 1e-5 || camera.viewport.x <= 0.0 || camera.viewport.y <= 0.0) {
    return vec4<f32>(2.0, 2.0, 2.0, 1.0);
  }
  let tip = screenPoint(clipEnd);
  let delta = tip - screenPoint(clipStart);
  let lengthDelta = length(delta);
  if (lengthDelta != lengthDelta || lengthDelta <= 1e-5) {
    return vec4<f32>(2.0, 2.0, 2.0, 1.0);
  }
  let direction = delta / lengthDelta;
  let normal = vec2<f32>(-direction.y, direction.x);
  let base = tip - direction * max(width * 3.5, 6.0 * camera.devicePixelRatio);
  let baseWidth = max(width * 2.5, 3.0 * camera.devicePixelRatio);
  if (corner == 0u) { return clipPoint(clipEnd, tip); }
  if (corner == 1u) { return clipPoint(clipEnd, base + normal * baseWidth); }
  return clipPoint(clipEnd, base - normal * baseWidth);
}

fn glyphDirection(record: GlyphRecord, instance: Instance, slot: u32) -> vec3<f32> {
  if (glyphParams.transformMode == 1u) {
    let matrix = glyphNormalMatrices[slot];
    return finiteDirection(
      matrix.column0.xyz * record.direction.x +
      matrix.column1.xyz * record.direction.y +
      matrix.column2.xyz * record.direction.z,
    );
  }
  return finiteDirection((instance.transform * vec4<f32>(record.direction.xyz, 0.0)).xyz);
}

fn glyphVisible(slot: u32, record: GlyphRecord) -> bool {
  return bodyOwnerVisible(slot, record.ids.y) && elementOwnerVisible(slot, record.ids.x + 1u);
}

fn glyphVertex(
  instanceIndex: u32,
  vertexIndex: u32,
) -> GlyphVertexOutput {
  let glyphCount = arrayLength(&glyphRecords);
  let glyphIndex = instanceIndex % glyphCount;
  let occurrenceIndex = instanceIndex / glyphCount;
  let slot = drawOrder[occurrenceIndex];
  let instance = instances[slot];
  let record = glyphRecords[glyphIndex];
  let direction = glyphDirection(record, instance, slot);
  let glyphLength = max(record.anchorLength.w * glyphParams.lengthScale, 0.0);
  let localAnchor = record.anchorLength.xyz + record.anchorDelta.xyz * deformation.scale;
  let anchor = (instance.transform * vec4<f32>(localAnchor, 1.0)).xyz;
  let directionLength = length(direction);
  var start = anchor;
  var end = anchor + direction * glyphLength;
  if (glyphParams.mode == 1u) {
    start = anchor - direction * (glyphLength * 0.5);
    end = anchor + direction * (glyphLength * 0.5);
  }
  let clipStart = camera.viewProjection * vec4<f32>(start, 1.0);
  let clipEnd = camera.viewProjection * vec4<f32>(end, 1.0);
  let width = glyphParams.widthPixels * camera.devicePixelRatio;
  var position = vec4<f32>(2.0, 2.0, 2.0, 1.0);
  if (directionLength > 0.0 && glyphVisible(slot, record)) {
    if (vertexIndex < 6u) {
      position = segmentVertex(clipStart, clipEnd, vertexIndex % 4u, width);
    } else if (glyphParams.mode == 0u) {
      position = arrowHeadVertex(clipStart, clipEnd, (vertexIndex - 6u) % 3u, width);
    }
  }
  var output: GlyphVertexOutput;
  output.position = position;
  output.worldPosition = select(anchor, end, vertexIndex >= 6u);
  output.axis = record.ids.z;
  output.triad = select(0u, 1u, glyphParams.mode == 2u);
  return output;
}

@vertex
fn vertexMain(
  @builtin(instance_index) instanceIndex: u32,
  @builtin(vertex_index) vertexIndex: u32,
) -> GlyphVertexOutput {
  return glyphVertex(instanceIndex, vertexIndex);
}
`;

/** Vertex shader for the renderer-owned elemental orientation glyph pass. */
export const orientationGlyphVertexShader = glyphVertexShared;

/** Opaque visible glyph fragments. */
export const orientationGlyphColorFragmentShader = /* wgsl */ `
${sectionPlaneBindings}
${sectionPlaneFunction}

@fragment
fn fragmentMain(@location(0) worldPosition: vec3<f32>, @location(1) @interpolate(flat) axis: u32, @location(2) @interpolate(flat) triad: u32) -> @location(0) vec4<f32> {
  if (!sectionPlaneVisible(worldPosition)) { discard; }
  if (triad == 1u && axis == 0u) { return vec4<f32>(0.9, 0.15, 0.12, 1.0); }
  if (triad == 1u && axis == 1u) { return vec4<f32>(0.15, 0.8, 0.25, 1.0); }
  if (triad == 1u && axis == 2u) { return vec4<f32>(0.2, 0.4, 0.95, 1.0); }
  return vec4<f32>(0.98, 0.72, 0.12, 1.0);
}
`;

/** Fixed-alpha weighted ghost fragments behind opaque model geometry. */
export const orientationGlyphTransparencyFragmentShader = /* wgsl */ `
${sectionPlaneBindings}
${sectionPlaneFunction}
${transparencyOutput}

@fragment
fn fragmentMain(@builtin(position) position: vec4<f32>, @location(0) worldPosition: vec3<f32>, @location(1) @interpolate(flat) axis: u32, @location(2) @interpolate(flat) triad: u32) -> TransparencyOutput {
  if (!sectionPlaneVisible(worldPosition)) { discard; }
  var color = vec3<f32>(0.98, 0.72, 0.12);
  if (triad == 1u && axis == 0u) { color = vec3<f32>(0.9, 0.15, 0.12); }
  if (triad == 1u && axis == 1u) { color = vec3<f32>(0.15, 0.8, 0.25); }
  if (triad == 1u && axis == 2u) { color = vec3<f32>(0.2, 0.4, 0.95); }
  return weightedPresentationTransparency(color, 0.35);
}
`;
