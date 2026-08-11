import {
  cameraStruct,
  deformationStruct,
  displacementFn,
  emphasisStructs,
  frameBindings,
  instanceBindings,
  instanceStruct,
  pickDataBindings,
  vertexOutput,
} from "./gpu-shaders";
import { emphasisHash } from "./gpu-highlight-shader";

/** Shared vertex stage for triangle and line primitives. */
export const instanceVertexShader = /* wgsl */ `
${cameraStruct}

${deformationStruct}

${instanceStruct}

${emphasisStructs}
${emphasisHash}

${frameBindings}
${instanceBindings}
${pickDataBindings}

${displacementFn}

${vertexOutput}

@vertex
fn vertexMain(
  @location(0) position: vec3<f32>,
  @builtin(instance_index) instanceIndex: u32,
  @builtin(vertex_index) vertexIndex: u32,
) -> VertexOutput {
  let instance = instances[drawOrder[instanceIndex]];
  let elementPickId = triangleElementPickIds[vertexIndex / 3u];
  let faceBodyPickIds = triangleFaceBodyPickIds[vertexIndex / 3u];
  let facePickId = faceBodyPickIds.x;
  let bodyPickId = faceBodyPickIds.y;
  var color = instance.color;
  var emissive = instance.emissive;
  var hidden = false;
  var matched = false;
  if (bodyPickId != 0u && elementHighlights.bucketCount != 0u) {
    let bucket = highlightHash(drawOrder[instanceIndex], bodyPickId, 0xffffffffu, 0u, elementHighlights.seed) & (elementHighlights.bucketCount - 1u);
    let base = bucket * 4u;
    for (var offset = 0u; offset < 4u; offset++) {
      let highlight = elementHighlights.records[base + offset];
      if (highlight.slot == drawOrder[instanceIndex] && highlight.elementPickId == bodyPickId && highlight.facePickId == 0xffffffffu) {
        color = highlight.color;
        emissive = highlight.emissive;
        hidden = highlight.hidden != 0u;
        break;
      }
    }
  }
  if (elementPickId != 0u && elementHighlights.bucketCount != 0u) {
    let bucket = highlightHash(drawOrder[instanceIndex], elementPickId, 0u, 0u, elementHighlights.seed) & (elementHighlights.bucketCount - 1u);
    let base = bucket * 4u;
    for (var offset = 0u; offset < 4u; offset++) {
      let highlight = elementHighlights.records[base + offset];
      if (highlight.slot == drawOrder[instanceIndex] && highlight.elementPickId == elementPickId && highlight.facePickId == 0u) {
        color = highlight.color;
        emissive = highlight.emissive;
        matched = true;
        break;
      }
    }
  }
  if (!matched && facePickId != 0u && elementHighlights.bucketCount != 0u) {
    let bucket = highlightHash(drawOrder[instanceIndex], 0u, facePickId, 0u, elementHighlights.seed) & (elementHighlights.bucketCount - 1u);
    let base = bucket * 4u;
    for (var offset = 0u; offset < 4u; offset++) {
      let highlight = elementHighlights.records[base + offset];
      if (highlight.slot == drawOrder[instanceIndex] && highlight.facePickId == facePickId) {
        color = highlight.color;
        emissive = highlight.emissive;
        break;
      }
    }
  }
  var output: VertexOutput;
  output.position = camera.viewProjection * instance.transform * vec4<f32>(displaced(position, vertexIndex), 1.0);
  if (hidden) {
    output.position = vec4<f32>(2.0, 2.0, 2.0, 1.0);
  }
  output.color = color;
  output.pickId = instance.pickId;
  output.emissive = emissive;
  output.elementPickId = elementPickId;
  output.facePickId = facePickId;
  output.local = vec2<f32>(0.0);
  output.centerPixel = vec2<f32>(0.0);
  output.nodeDepth = 0.0;
  return output;
}

`;

/**
 * Vertex stage for point-sprite parts. Each point is a quad of four vertices
 * with the same center; `vertex_index % 4` selects the sprite corner, which
 * is offset in clip space so points stay a constant screen size and always
 * face the camera. Node-overlay sprites use a smaller diameter and the same
 * exact-depth path.
 */
export const pointVertexShader = /* wgsl */ `
${cameraStruct}

${deformationStruct}

${instanceStruct}
${emphasisStructs}
${emphasisHash}

${frameBindings}
${instanceBindings}
${pickDataBindings}

${displacementFn}

${vertexOutput}

fn spriteCorner(corner: u32) -> vec2<f32> {
  switch corner {
    case 0u: { return vec2<f32>(-1.0, -1.0); }
    case 1u: { return vec2<f32>(1.0, -1.0); }
    case 2u: { return vec2<f32>(1.0, 1.0); }
    default: { return vec2<f32>(-1.0, 1.0); }
  }
}

fn pointVertex(position: vec3<f32>, instanceIndex: u32, vertexIndex: u32, sizeScale: f32) -> VertexOutput {
  let instance = instances[drawOrder[instanceIndex]];
  let corner = spriteCorner(vertexIndex % 4u);
  let clip = camera.viewProjection * instance.transform * vec4<f32>(displaced(position, vertexIndex), 1.0);
  let offset = (corner * camera.pointSize * sizeScale) / camera.viewport;
  let ndc = clip.xy / clip.w;
  let bodyPickId = triangleFaceBodyPickIds[vertexIndex / 4u].y;
  var output: VertexOutput;
  output.position = vec4<f32>(
    clip.x + offset.x * clip.w,
    clip.y + offset.y * clip.w,
    clip.z,
    clip.w,
  );
  var color = vec4<f32>(0.0, 0.0, 0.0, 0.45);
  var emissive = 0.0;
  var hidden = false;
  if (bodyPickId != 0u && elementHighlights.bucketCount != 0u) {
    let bucket = highlightHash(drawOrder[instanceIndex], bodyPickId, 0xffffffffu, 0u, elementHighlights.seed) & (elementHighlights.bucketCount - 1u);
    let base = bucket * 4u;
    for (var offset = 0u; offset < 4u; offset++) {
      let highlight = elementHighlights.records[base + offset];
      if (highlight.slot == drawOrder[instanceIndex] && highlight.elementPickId == bodyPickId && highlight.facePickId == 0xffffffffu) {
        color = highlight.color;
        emissive = highlight.emissive;
        hidden = highlight.hidden != 0u;
        break;
      }
    }
  }
  let nodePickId = vertexNodePickIds[vertexIndex];
  if (nodePickId != 0u && elementHighlights.bucketCount != 0u) {
    let bucket = highlightHash(drawOrder[instanceIndex], 0u, 0u, nodePickId, elementHighlights.seed) & (elementHighlights.bucketCount - 1u);
    let base = bucket * 4u;
    for (var offset = 0u; offset < 4u; offset++) {
      let highlight = elementHighlights.records[base + offset];
      if (highlight.slot == drawOrder[instanceIndex] && highlight.nodePickId == nodePickId) {
        color = highlight.color;
        emissive = highlight.emissive;
        break;
      }
    }
  }
  if (hidden) {
    output.position = vec4<f32>(2.0, 2.0, 2.0, 1.0);
  }
  output.color = color;
  output.pickId = instance.pickId;
  output.emissive = emissive;
  output.elementPickId = 0u;
  output.facePickId = 0u;
  output.local = corner;
  output.centerPixel = vec2<f32>(
    (ndc.x * 0.5 + 0.5) * camera.viewport.x,
    (0.5 - ndc.y * 0.5) * camera.viewport.y,
  );
  output.nodeDepth = clip.z / clip.w;
  return output;
}

@vertex
fn pointVertexMain(@location(0) position: vec3<f32>, @builtin(instance_index) instanceIndex: u32, @builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  return pointVertex(position, instanceIndex, vertexIndex, 1.0);
}

@vertex
fn nodeOverlayVertexMain(@location(0) position: vec3<f32>, @builtin(instance_index) instanceIndex: u32, @builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  return pointVertex(position, instanceIndex, vertexIndex, 0.75);
}
`;
