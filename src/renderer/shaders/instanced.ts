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
  vertexOutput,
} from "./scene";
import { emphasisHash } from "./highlight";

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
        color = highlight.color;
        resultColorEnabled = select(
          false,
          resultColorActive(nodePickId, elementOrdinal),
          highlight.keepsResultColor,
        );
        emissive = highlight.emissive;
        hidden = highlight.hidden != 0u;
        selected = selected || highlight.selected != 0u;
        break;
      }
    }
  }
  if (elementOrdinal != 0u && denseElementSelected(drawOrder[instanceIndex], elementOrdinal)) {
    color = applyDenseSelectionColor(color);
    emissive = applyDenseSelectionEmissive(emissive);
    resultColorEnabled = select(
      resultColorActive(nodePickId, elementOrdinal),
      false,
      (elementHighlights.selectionFlags & 1u) != 0u,
    );
    selected = true;
    exactSelection = true;
  }
  if (elementPickId != 0u && elementHighlights.bucketCount != 0u) {
    let bucket = highlightHash(drawOrder[instanceIndex], elementPickId, 0u, 0u, elementHighlights.seed) & (elementHighlights.bucketCount - 1u);
    let base = bucket * 4u;
    for (var offset = 0u; offset < 4u; offset++) {
      let highlight = elementHighlightAt(base + offset);
      if (highlight.slot == drawOrder[instanceIndex] && highlight.elementPickId == elementPickId && highlight.facePickId == 0u) {
        color = highlight.color;
        resultColorEnabled = select(
          false,
          resultColorActive(nodePickId, elementOrdinal),
          highlight.keepsResultColor,
        );
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

function instanceHighlighting(nodeIndex: string): string {
  return /* wgsl */ `
  let facePickId = faceBodyPickIds.x;
  let bodyPickId = faceBodyPickIds.y;
  let nodePickId = vertexNodePickIds[${nodeIndex}];
  let baseResultColor = resultColorFor(nodePickId, elementOrdinal, instance.color);
  var color = baseResultColor;
  var resultColorEnabled = resultColorActive(nodePickId, elementOrdinal);
  var emissive = instance.emissive;
  var hidden = false;
  var matched = false;
  var selected = instanceSelected(instance.selected);
  var exactSelection = false;
  if (selected) {
    color = instance.color;
    resultColorEnabled = false;
  }
  if (instanceHasPrimitiveEmphasis(instance.selected)) {
${bodyAndElementHighlighting}
  if (!matched && facePickId != 0u && elementHighlights.bucketCount != 0u) {
    let bucket = highlightHash(drawOrder[instanceIndex], 0u, facePickId, 0u, elementHighlights.seed) & (elementHighlights.bucketCount - 1u);
    let base = bucket * 4u;
    for (var offset = 0u; offset < 4u; offset++) {
      let highlight = elementHighlightAt(base + offset);
      if (highlight.slot == drawOrder[instanceIndex] && highlight.facePickId == facePickId) {
        if (!highlight.keepsResultColor) { color = highlight.color; }
        if (highlight.selected == 0u && !highlight.keepsResultColor) { resultColorEnabled = false; }
        emissive = highlight.emissive;
        selected = selected || highlight.selected != 0u;
        exactSelection = exactSelection || highlight.selected != 0u;
        break;
      }
    }
  }
  }
`;
}

function createInstanceVertexMain(
  primitiveIndex: string,
  selectionPass: boolean,
  linePass: boolean,
): string {
  const sourceIndex = linePass ? "vertexIndex" : "sourceVertexIndex";
  const positionInput = linePass ? "  @location(0) position: vec3<f32>,\n" : "";
  const positionPrelude = linePass
    ? ""
    : "  let sourceVertexIndex = geometrySourceIndex(vertexIndex);\n  let position = geometryPositionVec(sourceVertexIndex);\n";
  return /* wgsl */ `
@vertex
fn vertexMain(
${positionInput}  @builtin(instance_index) instanceIndex: u32,
  @builtin(vertex_index) vertexIndex: u32,
) -> VertexOutput {
${positionPrelude}
  let instance = instances[drawOrder[instanceIndex]];
  let elementPickId = primitiveElementId(${primitiveIndex});
  let elementOrdinal = primitiveElementOrdinal(${primitiveIndex});
  let faceBodyPickIds = primitiveFaceBodyPickIds(${primitiveIndex});
${instanceHighlighting(sourceIndex)}
${createInstanceVertexOutput(primitiveIndex, selectionPass, linePass, sourceIndex)}
}
`;
}

function createInstanceVertexOutput(
  primitiveIndex: string,
  selectionPass: boolean,
  linePass: boolean,
  sourceIndex: string,
): string {
  const visibility = selectionPass
    ? `primitiveSelectionVisible(drawOrder[instanceIndex], ${primitiveIndex}, exactSelection)`
    : `primitiveVisible(drawOrder[instanceIndex], ${primitiveIndex})`;
  return /* wgsl */ `
  var output: VertexOutput;
  let displayedPosition = displaced(position, ${sourceIndex});
  let worldPosition = (instance.transform * vec4<f32>(displayedPosition, 1.0)).xyz;
${linePass ? lineExpandedPosition() : "  output.position = camera.viewProjection * vec4<f32>(worldPosition, 1.0);"}
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
  return `${instanceVertexHeader}${createInstanceVertexMain(primitiveIndex, selectionPass, false)}`;
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
  primitiveIndex: u32,
  nodeIndex: u32,
  cornerIndex: u32,
  nodeOverlay: bool,
) -> VertexOutput {
  let instance = instances[drawOrder[instanceIndex]];
  let corner = spriteCorner(cornerIndex);
  let displayedPosition = displaced(position, nodeIndex);
  let worldPosition = (instance.transform * vec4<f32>(displayedPosition, 1.0)).xyz;
  let clip = camera.viewProjection * vec4<f32>(worldPosition, 1.0);
  let diameter = select(camera.pointSize, camera.nodeSize, nodeOverlay);
  let offset = (corner * diameter) / camera.viewport;
  let ndc = clip.xy / clip.w;
  let elementPickId = primitiveElementId(primitiveIndex);
  let elementOrdinal = primitiveElementOrdinal(primitiveIndex);
  let bodyPickId = primitiveFaceBodyPickIds(primitiveIndex).y;
  let nodePickId = vertexNodePickIds[nodeIndex];
  var output: VertexOutput;
  output.position = vec4<f32>(
    clip.x + offset.x * clip.w,
    clip.y + offset.y * clip.w,
    clip.z,
    clip.w,
  );
  let baseResultColor = resultColorFor(nodePickId, elementOrdinal, instance.color);
  var color = select(
    baseResultColor,
    vec4<f32>(0.0, 0.0, 0.0, 0.45 * instance.color.a),
    nodeOverlay,
  );
  var resultColorEnabled = !nodeOverlay && resultColorActive(nodePickId, elementOrdinal);
  if (nodeOverlay && instanceSelected(instance.selected)) {
    color = instance.color;
  }
  var emissive = instance.emissive;
  var hidden = false;
  var matched = false;
  var selected = instanceSelected(instance.selected);
  var exactSelection = false;
  if (selected && !nodeOverlay) {
    color = instance.color;
    resultColorEnabled = false;
  }
  if (instanceHasPrimitiveEmphasis(instance.selected)) {
  let denseNode = denseNodeSelected(drawOrder[instanceIndex], nodePickId);
  if (!nodeOverlay) {
${bodyAndElementHighlighting}
  }
  // Body/element emphasis establishes the resolved base first. Dense node
  // membership then follows the same precedence as sparse node records.
  if (denseNode) {
    emissive = instance.emissive;
    if (nodeOverlay && (elementHighlights.selectionFlags & 3u) != 0u) {
      color = instance.color;
    }
    color = applyDenseSelectionColor(color);
    emissive = applyDenseSelectionEmissive(emissive);
    selected = true;
    exactSelection = true;
  }
  if (nodePickId != 0u && elementHighlights.bucketCount != 0u) {
    let bucket = highlightHash(drawOrder[instanceIndex], 0u, 0u, nodePickId, elementHighlights.seed) & (elementHighlights.bucketCount - 1u);
    let base = bucket * 4u;
    for (var offset = 0u; offset < 4u; offset++) {
      let highlight = elementHighlightAt(base + offset);
      if (highlight.slot == drawOrder[instanceIndex] && highlight.nodePickId == nodePickId) {
        if (!highlight.keepsResultColor) { color = highlight.color; }
        if (highlight.selected == 0u && !highlight.keepsResultColor) { resultColorEnabled = false; }
        emissive = highlight.emissive;
        selected = selected || highlight.selected != 0u;
        break;
      }
    }
  }
  }
  if (nodeOverlay && !topologyAnyOwnerVisible(drawOrder[instanceIndex], primitiveIndex)) {
    hidden = true;
  }
  if (!nodeOverlay && !primitiveVisible(drawOrder[instanceIndex], primitiveIndex)) {
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
  return pointVertex(position, instanceIndex, vertexIndex / 4u, vertexIndex, vertexIndex % 4u, false);
}

@vertex
fn nodeOverlayVertexMain(@builtin(instance_index) instanceIndex: u32, @builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  let spriteIndex = vertexIndex / 4u;
  let positionBase = spriteIndex * 3u;
  let position = vec3<f32>(
    geometryPosition(positionBase),
    geometryPosition(positionBase + 1u),
    geometryPosition(positionBase + 2u),
  );
  return pointVertex(position, instanceIndex, spriteIndex, spriteIndex, vertexIndex % 4u, true);
}
`;
