import { EDGE_HIGHLIGHT_MARKER } from "../selection/highlight-table";
import { emphasisHash } from "./highlight";
import {
  cameraStruct,
  deformationStruct,
  displacementFn,
  emphasisStructs,
  frameBindings,
  geometryPositionBindings,
  instanceBindings,
  instanceStruct,
} from "./scene";
import { pickDataBindings } from "./topology";

/**
 * Vertex stage for the wireframe/edge display pass. It draws deduplicated mesh
 * edges as neutral black one-device-pixel native lines above the solid surface.
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
${geometryPositionBindings}

${displacementFn}

struct EdgeOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec4<f32>,
  @location(2) @interpolate(flat) emissive: f32,
  @location(5) local: vec2<f32>,
  @location(8) worldPosition: vec3<f32>,
};

@vertex
fn vertexMain(
  @location(0) position: vec3<f32>,
  @builtin(instance_index) instanceIndex: u32,
  @builtin(vertex_index) vertexIndex: u32,
) -> EdgeOutput {
  let slot = drawOrder[instanceIndex];
  let instance = instances[slot];
  let topologyIndex = edgeId(vertexIndex);
  let linePosition = vec3<f32>(
    geometryPosition(vertexIndex * 3u),
    geometryPosition(vertexIndex * 3u + 1u),
    geometryPosition(vertexIndex * 3u + 2u),
  );
  var output: EdgeOutput;
  output.position = camera.viewProjection * instance.transform * vec4<f32>(displaced(linePosition, vertexIndex), 1.0);
  if (!topologyOwnersVisible(slot, topologyIndex)) {
    output.position = vec4<f32>(2.0, 2.0, 2.0, 1.0);
  }
  output.color = vec4<f32>(0.0, 0.0, 0.0, 0.45 * instance.color.a);
  output.emissive = 0.0;
  var edgeColor = output.color;
  var edgeEmissive = 0.0;
  if (instanceHasEdgeEmphasis(instance.selected)) {
    let edgePickId = topologyIndex + 1u;
    let bucket = highlightHash(slot, edgePickId, ${EDGE_HIGHLIGHT_MARKER}u, 0u, elementHighlights.seed) & (elementHighlights.bucketCount - 1u);
    let base = bucket * 4u;
    var matched = false;
    for (var offset = 0u; offset < 4u; offset++) {
      let highlight = elementHighlightAt(base + offset);
      if (highlight.slot == slot && highlight.elementPickId == edgePickId && highlight.facePickId == ${EDGE_HIGHLIGHT_MARKER}u) {
        edgeColor = highlight.color;
        edgeEmissive = highlight.emissive;
        matched = true;
        break;
      }
    }
    if (!matched) { edgeColor.a = 0.0; }
  }
  output.color = edgeColor;
  output.emissive = edgeEmissive;
  output.local = vec2<f32>(0.0);
  output.worldPosition = (instance.transform * vec4<f32>(displaced(position, vertexIndex), 1.0)).xyz;
  return output;
}
`;
