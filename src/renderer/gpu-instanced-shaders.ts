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
  pickDataBindings,
  resultColorFunctions,
  spriteCornerFn,
  trianglePickExpansionFn,
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
${geometryPositionBindings}

${displacementFn}
${resultColorFunctions}

${vertexOutput}
`;

const bodyAndElementHighlighting = /* wgsl */ `
  if (bodyPickId != 0u && elementHighlights.bucketCount != 0u) {
    let bucket = highlightHash(drawOrder[instanceIndex], bodyPickId, 0xffffffffu, 0u, elementHighlights.seed) & (elementHighlights.bucketCount - 1u);
    let base = bucket * 4u;
    for (var offset = 0u; offset < 4u; offset++) {
      let highlight = elementHighlightAt(base + offset);
      if (highlight.slot == drawOrder[instanceIndex] && highlight.elementPickId == bodyPickId && highlight.facePickId == 0xffffffffu) {
        if (!highlight.preservesDisplayedColor) { color = highlight.color; }
        selectionKeepsResult = selectionKeepsResult || highlight.selected != 0u || highlight.preservesDisplayedColor;
        if (highlight.selected == 0u && !highlight.preservesDisplayedColor) { resultColorEnabled = false; }
        emissive = highlight.emissive;
        hidden = highlight.hidden != 0u;
        selected = selected || highlight.selected != 0u;
        break;
      }
    }
  }
  if (blockPickId != 0u && elementHighlights.bucketCount != 0u) {
    let bucket = highlightHash(drawOrder[instanceIndex], blockPickId, 0xfffffffeu, 0u, elementHighlights.seed) & (elementHighlights.bucketCount - 1u);
    let base = bucket * 4u;
    for (var offset = 0u; offset < 4u; offset++) {
      let highlight = elementHighlightAt(base + offset);
      if (highlight.slot == drawOrder[instanceIndex] && highlight.blockPickId == blockPickId && highlight.elementPickId == blockPickId && highlight.facePickId == 0xfffffffeu) {
        if (!highlight.preservesDisplayedColor) { color = highlight.color; }
        selectionKeepsResult = selectionKeepsResult || highlight.selected != 0u || highlight.preservesDisplayedColor;
        if (highlight.selected == 0u && !highlight.preservesDisplayedColor) { resultColorEnabled = false; }
        emissive = highlight.emissive;
        hidden = hidden || highlight.hidden != 0u;
        matched = true;
        selected = selected || highlight.selected != 0u;
        exactSelection = exactSelection || highlight.selected != 0u;
        break;
      }
    }
  }
  if (elementOrdinal != 0u && denseElementSelected(drawOrder[instanceIndex], elementOrdinal)) {
    color = applyDenseSelectionColor(color);
    emissive = applyDenseSelectionEmissive(emissive);
    selectionKeepsResult = true;
    selected = true;
    exactSelection = true;
  }
  if (elementPickId != 0u && elementHighlights.bucketCount != 0u) {
    let bucket = highlightHash(drawOrder[instanceIndex], elementPickId, 0u, 0u, elementHighlights.seed) & (elementHighlights.bucketCount - 1u);
    let base = bucket * 4u;
    for (var offset = 0u; offset < 4u; offset++) {
      let highlight = elementHighlightAt(base + offset);
      if (highlight.slot == drawOrder[instanceIndex] && highlight.elementPickId == elementPickId && highlight.facePickId == 0u) {
        if (!highlight.preservesDisplayedColor) { color = highlight.color; }
        selectionKeepsResult = selectionKeepsResult || highlight.selected != 0u || highlight.preservesDisplayedColor;
        if (highlight.selected == 0u && !highlight.preservesDisplayedColor) { resultColorEnabled = false; }
        emissive = highlight.emissive;
        hidden = hidden || highlight.hidden != 0u;
        matched = true;
        selected = selected || highlight.selected != 0u;
        exactSelection = exactSelection || highlight.selected != 0u;
        break;
      }
    }
  }
`;

const instanceHighlighting = /* wgsl */ `
  let facePickId = faceBodyPickIds.x;
  let bodyPickId = faceBodyPickIds.y;
  let blockPickId = primitiveFaceBlockPickIds(primitiveDrawId(vertexIndex)).x;
  let nodePickId = vertexNodePickIds[vertexIndex];
  let baseResultColor = resultColorForNode(nodePickId, instance.color);
  var color = baseResultColor;
  var resultColorEnabled = resultColorActive(nodePickId);
  var selectionKeepsResult = false;
  var emissive = instance.emissive;
  var hidden = false;
  var matched = false;
  var selected = instanceSelected(instance.selected);
  var exactSelection = false;
  if (instanceHasPrimitiveEmphasis(instance.selected)) {
${bodyAndElementHighlighting}
  if (!matched && facePickId != 0u && elementHighlights.bucketCount != 0u) {
    let bucket = highlightHash(drawOrder[instanceIndex], 0u, facePickId, 0u, elementHighlights.seed) & (elementHighlights.bucketCount - 1u);
    let base = bucket * 4u;
    for (var offset = 0u; offset < 4u; offset++) {
    let highlight = elementHighlightAt(base + offset);
      if (highlight.slot == drawOrder[instanceIndex] && highlight.facePickId == facePickId) {
        if (!highlight.preservesDisplayedColor) { color = highlight.color; }
        selectionKeepsResult = selectionKeepsResult || highlight.selected != 0u || highlight.preservesDisplayedColor;
        if (highlight.selected == 0u && !highlight.preservesDisplayedColor) { resultColorEnabled = false; }
        emissive = highlight.emissive;
        selected = selected || highlight.selected != 0u;
        exactSelection = exactSelection || highlight.selected != 0u;
        break;
      }
    }
  }
  }
  if (selectionKeepsResult) {
    resultColorEnabled = resultColorActive(nodePickId);
  }
`;

function createInstanceVertexMain(
  primitiveIndex: string,
  selectionPass: boolean,
  linePass: boolean,
): string {
  return /* wgsl */ `
@vertex
fn vertexMain(
  @location(0) position: vec3<f32>,
  @builtin(instance_index) instanceIndex: u32,
  @builtin(vertex_index) vertexIndex: u32,
) -> VertexOutput {
  let instance = instances[drawOrder[instanceIndex]];
  let elementPickId = primitiveElementId(${primitiveIndex});
  let elementOrdinal = primitiveElementOrdinal(${primitiveIndex});
  let faceBodyPickIds = primitiveFaceBodyPickIds(${primitiveIndex});
${instanceHighlighting}
${createInstanceVertexOutput(primitiveIndex, selectionPass, linePass)}
}
`;
}

function createInstanceVertexOutput(
  primitiveIndex: string,
  selectionPass: boolean,
  linePass: boolean,
): string {
  const visibility = selectionPass
    ? `primitiveSelectionVisible(drawOrder[instanceIndex], ${primitiveIndex}, exactSelection)`
    : `primitiveVisible(drawOrder[instanceIndex], ${primitiveIndex})`;
  return /* wgsl */ `
  var output: VertexOutput;
  let displayedPosition = displaced(position, vertexIndex);
  let worldPosition = (instance.transform * vec4<f32>(displayedPosition, 1.0)).xyz;
${linePass ? lineExpandedPosition() : selectionPass ? triangleSelectionPosition() : "  output.position = camera.viewProjection * vec4<f32>(worldPosition, 1.0);"}
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
  output.resultColor = baseResultColor;
  output.resultColorEnabled = select(0u, 1u, resultColorEnabled);
  if (!${visibility}) {
    output.position = vec4<f32>(2.0, 2.0, 2.0, 1.0);
  }
  return output;
`;
}

function createInstanceVertexShader(selectionPass = false): string {
  const primitiveIndex = "primitiveDrawId(vertexIndex)";
  const expansion = selectionPass ? trianglePickExpansionFn : "";
  return `${instanceVertexHeader}${expansion}${createInstanceVertexMain(primitiveIndex, selectionPass, false)}`;
}

export const instanceVertexShader = createInstanceVertexShader();

/** Triangle selection vertex stage that reveals exact selected internal faces. */
export const selectionVertexShader = createInstanceVertexShader(true);

function lineExpandedPosition(): string {
  return `
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
  let lineClipA = camera.viewProjection * instance.transform * vec4<f32>(displaced(lineA, lineBase), 1.0);
  let lineClipB = camera.viewProjection * instance.transform * vec4<f32>(displaced(lineB, lineBase + 1u), 1.0);
  output.position = lineExpandedPosition(
    lineClipA,
    lineClipB,
    vertexIndex % 4u,
    instance.lineWidth * camera.devicePixelRatio,
  );`;
}

function triangleSelectionPosition(): string {
  return `
  let triangleBase = vertexIndex - (vertexIndex % 3u);
  let triangleA = displaced(vec3<f32>(
    geometryPosition(triangleBase * 3u),
    geometryPosition(triangleBase * 3u + 1u),
    geometryPosition(triangleBase * 3u + 2u),
  ), triangleBase);
  let triangleB = displaced(vec3<f32>(
    geometryPosition(triangleBase * 3u + 3u),
    geometryPosition(triangleBase * 3u + 4u),
    geometryPosition(triangleBase * 3u + 5u),
  ), triangleBase + 1u);
  let triangleC = displaced(vec3<f32>(
    geometryPosition(triangleBase * 3u + 6u),
    geometryPosition(triangleBase * 3u + 7u),
    geometryPosition(triangleBase * 3u + 8u),
  ), triangleBase + 2u);
  let triangleCenterClip = camera.viewProjection * instance.transform * vec4<f32>(
    (triangleA + triangleB + triangleC) / 3.0,
    1.0,
  );
  output.position = trianglePickPosition(
    camera.viewProjection * instance.transform * vec4<f32>(triangleA, 1.0),
    camera.viewProjection * instance.transform * vec4<f32>(triangleB, 1.0),
    camera.viewProjection * instance.transform * vec4<f32>(triangleC, 1.0),
    triangleCenterClip,
    vertexIndex % 3u,
  );`;
}

function createLineVertexShader(selectionPass: boolean): string {
  const primitiveIndex = "primitiveDrawId(vertexIndex)";
  return `${instanceVertexHeader}${lineExpansionFn}${createInstanceVertexMain(
    primitiveIndex,
    selectionPass,
    true,
  )}`;
}

/** Triangle-list vertex stage for authored, screen-space-width lines. */
export const lineVertexShader = createLineVertexShader(false);

/** Selection variant of the authored line triangle-list vertex stage. */
export const lineSelectionVertexShader = createLineVertexShader(true);

/**
 * Vertex stage for point-sprite parts. Each point is a quad of four vertices
 * with the same center; `vertex_index % 4` selects the sprite corner, which
 * is offset in clip space so points stay a constant screen size and always
 * face the camera. Node-overlay sprites use the independent node diameter and
 * the same exact-depth path.
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
${geometryPositionBindings}

${displacementFn}
${resultColorFunctions}

${vertexOutput}

${spriteCornerFn}

fn pointVertex(
  position: vec3<f32>,
  instanceIndex: u32,
  vertexIndex: u32,
  nodeOverlay: bool,
) -> VertexOutput {
  let instance = instances[drawOrder[instanceIndex]];
  let corner = spriteCorner(vertexIndex % 4u);
  let displayedPosition = displaced(position, vertexIndex);
  let worldPosition = (instance.transform * vec4<f32>(displayedPosition, 1.0)).xyz;
  let clip = camera.viewProjection * vec4<f32>(worldPosition, 1.0);
  let diameter = select(camera.pointSize, camera.nodeSize, nodeOverlay);
  let offset = (corner * diameter) / camera.viewport;
  let ndc = clip.xy / clip.w;
  let elementPickId = primitiveElementId(vertexIndex / 4u);
  let elementOrdinal = primitiveElementOrdinal(vertexIndex / 4u);
  let bodyPickId = primitiveFaceBodyPickIds(vertexIndex / 4u).y;
  let blockPickId = primitiveFaceBlockPickIds(vertexIndex / 4u).x;
  let nodePickId = vertexNodePickIds[vertexIndex];
  var output: VertexOutput;
  output.position = vec4<f32>(
    clip.x + offset.x * clip.w,
    clip.y + offset.y * clip.w,
    clip.z,
    clip.w,
  );
  let baseResultColor = resultColorForNode(nodePickId, instance.color);
  var color = select(
    baseResultColor,
    vec4<f32>(0.0, 0.0, 0.0, 0.45 * instance.color.a),
    nodeOverlay,
  );
  var resultColorEnabled = !nodeOverlay && resultColorActive(nodePickId);
  var selectionKeepsResult = false;
  if (nodeOverlay && instanceSelected(instance.selected)) {
    color = instance.color;
  }
  var emissive = 0.0;
  var hidden = false;
  var matched = false;
  var selected = instanceSelected(instance.selected);
  var exactSelection = false;
  if (instanceHasPrimitiveEmphasis(instance.selected)) {
  if (!nodeOverlay) {
${bodyAndElementHighlighting}
  }
  if (nodePickId != 0u && elementHighlights.bucketCount != 0u) {
    let bucket = highlightHash(drawOrder[instanceIndex], 0u, 0u, nodePickId, elementHighlights.seed) & (elementHighlights.bucketCount - 1u);
    let base = bucket * 4u;
    for (var offset = 0u; offset < 4u; offset++) {
      let highlight = elementHighlightAt(base + offset);
      if (highlight.slot == drawOrder[instanceIndex] && highlight.nodePickId == nodePickId) {
        if (!highlight.preservesDisplayedColor) { color = highlight.color; }
        selectionKeepsResult = selectionKeepsResult || highlight.selected != 0u || highlight.preservesDisplayedColor;
        if (highlight.selected == 0u && !highlight.preservesDisplayedColor) { resultColorEnabled = false; }
        emissive = highlight.emissive;
        selected = selected || highlight.selected != 0u;
        break;
      }
    }
  }
  }
  if (nodeOverlay && !topologyAnyOwnerVisible(drawOrder[instanceIndex], vertexIndex / 4u)) {
    hidden = true;
  }
  if (selectionKeepsResult) {
    resultColorEnabled = !nodeOverlay && resultColorActive(nodePickId);
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
  output.resultColor = baseResultColor;
  output.resultColorEnabled = select(0u, 1u, resultColorEnabled);
  return output;
}

@vertex
fn pointVertexMain(@location(0) position: vec3<f32>, @builtin(instance_index) instanceIndex: u32, @builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  return pointVertex(position, instanceIndex, vertexIndex, false);
}

@vertex
fn nodeOverlayVertexMain(@location(0) position: vec3<f32>, @builtin(instance_index) instanceIndex: u32, @builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  return pointVertex(position, instanceIndex, vertexIndex, true);
}
`;
