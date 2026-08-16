import {
  cameraStruct,
  deformationStruct,
  displacementFn,
  emphasisStructs,
  frameBindings,
  geometryPositionBindings,
  instanceBindings,
  instanceStruct,
  pickDataBindings,
  resultColorFunctions,
  spriteCornerFn,
  vertexOutput,
} from "./scene";
import { emphasisHash } from "./highlight";

const nodeVertexHeader = /* wgsl */ `
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
`;

/** Dedicated vertex stage for compact, occurrence-instanced node overlays. */
export const nodeOverlayVertexShader = /* wgsl */ `
${nodeVertexHeader}

fn nodePointVertex(
  instanceIndex: u32,
  vertexIndex: u32,
) -> VertexOutput {
  let nodeCount = max(arrayLength(&vertexNodePickIds), 1u);
  let occurrenceIndex = instanceIndex / nodeCount;
  let nodeIndex = instanceIndex % nodeCount;
  let nodePickId = vertexNodePickIds[nodeIndex];
  let base = nodeIndex * 3u;
  let center = vec3<f32>(
    geometryPosition(base),
    geometryPosition(base + 1u),
    geometryPosition(base + 2u),
  );
  let displayedPosition = displacedForNode(center, nodePickId);
  let slot = drawOrder[occurrenceIndex];
  let instance = instances[slot];
  let corner = spriteCorner(vertexIndex % 4u);
  let worldPosition = (instance.transform * vec4<f32>(displayedPosition, 1.0)).xyz;
  let clip = camera.viewProjection * vec4<f32>(worldPosition, 1.0);
  let offset = (corner * camera.nodeSize) / camera.viewport;
  let ndc = clip.xy / clip.w;
  // Node annotations use their own color and fragment path; result colors are
  // resolved by surface primitives, not by this presentation overlay.
  let baseResultColor = instance.color;
  var color = vec4<f32>(0.0, 0.0, 0.0, 0.45 * instance.color.a);
  if (instanceSelected(instance.selected)) {
    color = instance.color;
  }
  var emissive = 0.0;
  var selected = instanceSelected(instance.selected);
  var hidden = false;
  if (instanceHasPrimitiveEmphasis(instance.selected) &&
      nodePickId != 0u && elementHighlights.bucketCount != 0u) {
    let bucket = highlightHash(slot, 0u, 0u, nodePickId, elementHighlights.seed) &
      (elementHighlights.bucketCount - 1u);
    let highlightBase = bucket * 4u;
    for (var offsetIndex = 0u; offsetIndex < 4u; offsetIndex++) {
      let highlight = elementHighlightAt(highlightBase + offsetIndex);
      if (highlight.slot == slot && highlight.nodePickId == nodePickId) {
        if (!highlight.preservesDisplayedColor) { color = highlight.color; }
        emissive = highlight.emissive;
        selected = selected || highlight.selected != 0u;
        break;
      }
    }
  }
  if (!topologyAnyOwnerVisible(slot, nodeIndex)) {
    hidden = true;
  }
  var output: VertexOutput;
  output.position = vec4<f32>(
    clip.x + offset.x * clip.w,
    clip.y + offset.y * clip.w,
    clip.z,
    clip.w,
  );
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
  output.worldPosition = worldPosition;
  output.selected = select(0u, 1u, selected);
  output.resultColor = baseResultColor;
  output.resultColorEnabled = 0u;
  output.edgeDepthRadius = 0.0;
  return output;
}

@vertex
fn nodeOverlayVertexMain(
  @location(0) _position: vec3<f32>,
  @builtin(instance_index) instanceIndex: u32,
  @builtin(vertex_index) vertexIndex: u32,
) -> VertexOutput {
  return nodePointVertex(instanceIndex, vertexIndex);
}
`;
