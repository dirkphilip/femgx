import {
  cameraStruct,
  deformationStruct,
  displacementFn,
  emphasisStructs,
  frameBindings,
  instanceBindings,
  instanceStruct,
  pickDataBindings,
  spriteCornerFn,
  vertexOutput,
} from "./gpu-shaders";
import { emphasisHash } from "./gpu-highlight-shader";

/** Shared vertex stage for triangle and line primitives. */
const instanceVertexHeader = /* wgsl */ `
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
`;

const instanceHighlighting = /* wgsl */ `
  let facePickId = faceBodyPickIds.x;
  let bodyPickId = faceBodyPickIds.y;
  var color = instance.color;
  var emissive = instance.emissive;
  var hidden = false;
  var matched = false;
  var selected = instance.selected != 0u;
  if (bodyPickId != 0u && elementHighlights.bucketCount != 0u) {
    let bucket = highlightHash(drawOrder[instanceIndex], bodyPickId, 0xffffffffu, 0u, elementHighlights.seed) & (elementHighlights.bucketCount - 1u);
    let base = bucket * 4u;
    for (var offset = 0u; offset < 4u; offset++) {
      let highlight = elementHighlights.records[base + offset];
      if (highlight.slot == drawOrder[instanceIndex] && highlight.elementPickId == bodyPickId && highlight.facePickId == 0xffffffffu) {
        color = highlight.color;
        emissive = highlight.emissive;
        hidden = highlight.hidden != 0u;
        selected = selected || highlight.selected != 0u;
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
        hidden = hidden || highlight.hidden != 0u;
        matched = true;
        selected = selected || highlight.selected != 0u;
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
        selected = selected || highlight.selected != 0u;
        break;
      }
    }
  }
`;

function createInstanceVertexMain(primitiveIndex: string): string {
  return /* wgsl */ `
@vertex
fn vertexMain(
  @location(0) position: vec3<f32>,
  @builtin(instance_index) instanceIndex: u32,
  @builtin(vertex_index) vertexIndex: u32,
) -> VertexOutput {
  let instance = instances[drawOrder[instanceIndex]];
  let elementPickId = primitiveElementPickIds[${primitiveIndex}];
  let faceBodyPickIds = primitiveFaceBodyPickIds(${primitiveIndex});
${instanceHighlighting}
${createInstanceVertexOutput(primitiveIndex)}
}
`;
}

function createInstanceVertexOutput(primitiveIndex: string): string {
  return /* wgsl */ `
  var output: VertexOutput;
  let displayedPosition = displaced(position, vertexIndex);
  let worldPosition = (instance.transform * vec4<f32>(displayedPosition, 1.0)).xyz;
  output.position = camera.viewProjection * vec4<f32>(worldPosition, 1.0);
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
  output.worldPosition = worldPosition;
  output.selected = select(0u, 1u, selected);
  if (!primitiveVisible(drawOrder[instanceIndex], ${primitiveIndex})) {
    output.position = vec4<f32>(2.0, 2.0, 2.0, 1.0);
  }
  return output;
`;
}

function createInstanceVertexShader(verticesPerPrimitive: 2 | 3): string {
  const primitiveIndex = `vertexIndex / ${verticesPerPrimitive}u`;
  return `${instanceVertexHeader}${createInstanceVertexMain(primitiveIndex)}`;
}

export const instanceVertexShader = createInstanceVertexShader(3);

/** Line-list variant of the shared element vertex shader. */
export const lineVertexShader = createInstanceVertexShader(2);

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

${spriteCornerFn}

fn pointVertex(
  position: vec3<f32>,
  instanceIndex: u32,
  vertexIndex: u32,
  sizeScale: f32,
  nodeOverlay: bool,
) -> VertexOutput {
  let instance = instances[drawOrder[instanceIndex]];
  let corner = spriteCorner(vertexIndex % 4u);
  let displayedPosition = displaced(position, vertexIndex);
  let worldPosition = (instance.transform * vec4<f32>(displayedPosition, 1.0)).xyz;
  let clip = camera.viewProjection * vec4<f32>(worldPosition, 1.0);
  let offset = (corner * camera.pointSize * sizeScale) / camera.viewport;
  let ndc = clip.xy / clip.w;
  let elementPickId = primitiveElementPickIds[vertexIndex / 4u];
  let bodyPickId = primitiveFaceBodyPickIds(vertexIndex / 4u).y;
  var output: VertexOutput;
  output.position = vec4<f32>(
    clip.x + offset.x * clip.w,
    clip.y + offset.y * clip.w,
    clip.z,
    clip.w,
  );
  var color = select(
    instance.color,
    vec4<f32>(0.0, 0.0, 0.0, 0.45 * instance.color.a),
    nodeOverlay,
  );
  if (nodeOverlay && instance.selected != 0u) {
    color = instance.color;
  }
  var emissive = 0.0;
  var hidden = false;
  var selected = instance.selected != 0u;
  if (bodyPickId != 0u && elementHighlights.bucketCount != 0u) {
    let bucket = highlightHash(drawOrder[instanceIndex], bodyPickId, 0xffffffffu, 0u, elementHighlights.seed) & (elementHighlights.bucketCount - 1u);
    let base = bucket * 4u;
    for (var offset = 0u; offset < 4u; offset++) {
      let highlight = elementHighlights.records[base + offset];
      if (highlight.slot == drawOrder[instanceIndex] && highlight.elementPickId == bodyPickId && highlight.facePickId == 0xffffffffu) {
        color = highlight.color;
        emissive = highlight.emissive;
        hidden = highlight.hidden != 0u;
        selected = selected || highlight.selected != 0u;
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
        hidden = hidden || highlight.hidden != 0u;
        selected = selected || highlight.selected != 0u;
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
        selected = selected || highlight.selected != 0u;
        break;
      }
    }
  }
  if (nodeOverlay && !topologyOwnersVisible(drawOrder[instanceIndex], vertexIndex / 4u)) {
    hidden = true;
  }
  if (!nodeOverlay && !primitiveVisible(drawOrder[instanceIndex], vertexIndex / 4u)) {
    hidden = true;
  }
  if (hidden) {
    output.position = vec4<f32>(2.0, 2.0, 2.0, 1.0);
  }
  output.color = color;
  output.pickId = instance.pickId;
  output.emissive = emissive;
  output.elementPickId = elementPickId;
  output.facePickId = 0u;
  output.local = corner;
  output.centerPixel = vec2<f32>(
    (ndc.x * 0.5 + 0.5) * camera.viewport.x,
    (0.5 - ndc.y * 0.5) * camera.viewport.y,
  );
  output.nodeDepth = clip.z / clip.w;
  output.worldPosition = worldPosition;
  output.selected = select(0u, 1u, selected);
  return output;
}

@vertex
fn pointVertexMain(@location(0) position: vec3<f32>, @builtin(instance_index) instanceIndex: u32, @builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  return pointVertex(position, instanceIndex, vertexIndex, 1.0, false);
}

@vertex
fn nodeOverlayVertexMain(@location(0) position: vec3<f32>, @builtin(instance_index) instanceIndex: u32, @builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  return pointVertex(position, instanceIndex, vertexIndex, 0.75, true);
}
`;
