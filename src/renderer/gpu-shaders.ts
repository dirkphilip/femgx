/**
 * Shared WGSL for the instanced render passes. All three vertex shaders read
 * the same camera uniform and per-part instance storage, so parts can mix
 * triangle, line, and point-sprite primitives within one frame. Triangle and
 * line primitives additionally read the per-triangle element pick ids and the
 * bounded element-highlight records so element-level emphasis can override the
 * resolved instance color; point sprites never carry element emphasis.
 */

/** Camera uniform: view projection plus viewport and point size in pixels. */
const cameraStruct = /* wgsl */ `
struct Camera {
  viewProjection: mat4x4<f32>,
  viewport: vec2<f32>,
  pointSize: f32,
  _padding: f32,
};
`;

/** Per-frame deformation uniform: displacement scale plus the active load case. */
const deformationStruct = /* wgsl */ `
struct Deformation {
  scale: f32,
  loadCase: u32,
  loadCaseCount: u32,
  _padding: u32,
};
`;

/** Instance storage layout shared by every vertex shader. */
const instanceStruct = /* wgsl */ `
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

/** Element-highlight records read by the triangle and line vertex stage. */
const elementHighlightStructs = /* wgsl */ `
// Field layout must match encodeElementHighlight in gpu-elements.ts:
// slot 0, elementPickId 4, padding 8, color 16, emissive 32. The struct has
// no trailing member so its size stays 48 bytes (vec3 members would force
// 16-byte alignment and a 64-byte stride that would not match the encoder).
struct ElementHighlight {
  slot: u32,
  elementPickId: u32,
  _padding: vec2<u32>,
  color: vec4<f32>,
  emissive: f32,
};

// records starts at byte offset 16 to keep the 16-byte element alignment;
// matches HIGHLIGHT_HEADER in gpu-elements.ts. The header padding is a plain
// array so it stays 4-byte aligned (a vec3 would move records to offset 32).
struct ElementHighlights {
  count: u32,
  _padding: array<u32, 3>,
  records: array<ElementHighlight, 128>,
};
`;

/** Instance storage binding layout shared by every vertex shader. */
const instanceBindings = /* wgsl */ `
@group(0) @binding(0) var<uniform> camera: Camera;
@group(0) @binding(1) var<uniform> deformation: Deformation;
@group(1) @binding(0) var<storage, read> instances: array<Instance>;
@group(1) @binding(1) var<storage, read> drawOrder: array<u32>;
@group(1) @binding(4) var<storage, read> displacements: array<f32>;
`;

/**
 * Displaces a model-space vertex by the active load case's nodal displacement,
 * scaled by the deformation uniform. Parts without a displacement buffer (or a
 * disabled deformation uniform) return the vertex unchanged. `vertexIndex` is
 * the vertex buffer index, which aligns with the node numbering for parts that
 * carry deformation data.
 */
const displacementFn = /* wgsl */ `
fn displaced(position: vec3<f32>, vertexIndex: u32) -> vec3<f32> {
  if (deformation.loadCaseCount == 0u) {
    return position;
  }
  let vertexCount = arrayLength(&displacements) / (3u * deformation.loadCaseCount);
  if (vertexCount == 0u) {
    return position;
  }
  let base = (deformation.loadCase * vertexCount + vertexIndex) * 3u;
  let delta = vec3<f32>(displacements[base], displacements[base + 1u], displacements[base + 2u]);
  return position + delta * deformation.scale;
}
`;

/** Shared vertex output for the color and picking fragment stages. */
const vertexOutput = /* wgsl */ `
struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec4<f32>,
  @location(1) @interpolate(flat) pickId: u32,
  @location(2) @interpolate(flat) emissive: f32,
  @location(3) @interpolate(flat) elementPickId: u32,
};
`;

/** Shared vertex stage for triangle and line primitives. */
export const instanceVertexShader = /* wgsl */ `
${cameraStruct}

${deformationStruct}

${instanceStruct}

${elementHighlightStructs}

${instanceBindings}

${displacementFn}

@group(1) @binding(2) var<storage, read> triangleElementPickIds: array<u32>;
@group(1) @binding(3) var<storage, read> elementHighlights: ElementHighlights;

${vertexOutput}

@vertex
fn vertexMain(
  @location(0) position: vec3<f32>,
  @builtin(instance_index) instanceIndex: u32,
  @builtin(vertex_index) vertexIndex: u32,
) -> VertexOutput {
  let instance = instances[drawOrder[instanceIndex]];
  let elementPickId = triangleElementPickIds[vertexIndex / 3u];
  var color = instance.color;
  var emissive = instance.emissive;
  for (var index = 0u; index < elementHighlights.count; index++) {
    let highlight = elementHighlights.records[index];
    if (highlight.slot == drawOrder[instanceIndex] && highlight.elementPickId == elementPickId) {
      color = highlight.color;
      emissive = highlight.emissive;
      break;
    }
  }
  var output: VertexOutput;
  output.position = camera.viewProjection * instance.transform * vec4<f32>(displaced(position, vertexIndex), 1.0);
  output.color = color;
  output.pickId = instance.pickId;
  output.emissive = emissive;
  output.elementPickId = elementPickId;
  return output;
}
`;

/**
 * Vertex stage for point-sprite parts. Each point is a quad of four vertices
 * with the same center; `vertex_index % 4` selects the sprite corner, which is
 * offset in clip space so points stay a constant screen size and always face
 * the camera. The quad's depth is the point's own depth, so picking and depth
 * testing behave like a true point primitive. Point geometry carries no
 * element tessellations, so the element pick id is always zero.
 */
export const pointVertexShader = /* wgsl */ `
${cameraStruct}

${deformationStruct}

${instanceStruct}

${instanceBindings}

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

@vertex
fn pointVertexMain(@location(0) position: vec3<f32>, @builtin(instance_index) instanceIndex: u32, @builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  let instance = instances[drawOrder[instanceIndex]];
  let corner = spriteCorner(vertexIndex % 4u);
  let clip = camera.viewProjection * instance.transform * vec4<f32>(displaced(position, vertexIndex), 1.0);
  let offset = (corner * camera.pointSize) / camera.viewport;
  var output: VertexOutput;
  output.position = vec4<f32>(clip.x + offset.x * clip.w, clip.y + offset.y * clip.w, clip.z, clip.w);
  output.color = instance.color;
  output.pickId = instance.pickId;
  output.emissive = instance.emissive;
  output.elementPickId = 0u;
  return output;
}
`;

/** Fragment stage for the visible color pass; emissive adds a white glow. */
export const colorFragmentShader = /* wgsl */ `
@fragment
fn fragmentMain(@location(0) color: vec4<f32>, @location(2) @interpolate(flat) emissive: f32) -> @location(0) vec4<f32> {
  return vec4<f32>(color.rgb + vec3<f32>(emissive), color.a);
}
`;

/**
 * Vertex stage for the wireframe/edge display pass. It draws the deduplicated
 * mesh edges as a line list in the resolved instance color, so hover/selection
 * still glow at the instance level without per-triangle element emphasis.
 */
export const edgeVertexShader = /* wgsl */ `
${cameraStruct}

${deformationStruct}

${instanceStruct}

${instanceBindings}

${displacementFn}

struct EdgeOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec4<f32>,
  @location(2) @interpolate(flat) emissive: f32,
};

@vertex
fn vertexMain(
  @location(0) position: vec3<f32>,
  @builtin(instance_index) instanceIndex: u32,
  @builtin(vertex_index) vertexIndex: u32,
) -> EdgeOutput {
  let instance = instances[drawOrder[instanceIndex]];
  var output: EdgeOutput;
  output.position = camera.viewProjection * instance.transform * vec4<f32>(displaced(position, vertexIndex), 1.0);
  output.color = instance.color;
  output.emissive = instance.emissive;
  return output;
}
`;

/**
 * Fragment stage for the picking pass. Packs the u32 pick ids across the four
 * RGBA bytes of an `rgba8unorm` target, mirroring `encodePickId` in
 * `pick-format.ts`; the byte order of both must stay in sync. Target 0 holds
 * the instance pick id and target 1 the element pick id.
 */
export const pickFragmentShader = /* wgsl */ `
fn packPickId(pickId: u32) -> vec4<f32> {
  return vec4<f32>(
    f32(pickId & 0xFFu) / 255.0,
    f32((pickId >> 8u) & 0xFFu) / 255.0,
    f32((pickId >> 16u) & 0xFFu) / 255.0,
    f32((pickId >> 24u) & 0xFFu) / 255.0,
  );
}

struct PickOutput {
  @location(0) instance: vec4<f32>,
  @location(1) element: vec4<f32>,
};

@fragment
fn fragmentMain(
  @location(1) @interpolate(flat) pickId: u32,
  @location(3) @interpolate(flat) elementPickId: u32,
) -> PickOutput {
  var output: PickOutput;
  output.instance = packPickId(pickId);
  output.element = packPickId(elementPickId);
  return output;
}
`;
