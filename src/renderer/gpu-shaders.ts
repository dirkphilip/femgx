/** Shared vertex stage for the color and picking render passes. */
export const instanceVertexShader = /* wgsl */ `
struct Camera {
  viewProjection: mat4x4<f32>,
};

// Field layout (byte offsets) must match encodeInstanceRecord in gpu-draw.ts:
// transform 0, color 64, pickId 80, emissive 84, padding 88.
struct Instance {
  transform: mat4x4<f32>,
  color: vec4<f32>,
  pickId: u32,
  emissive: f32,
  _padding: vec2<u32>,
};

// Field layout must match encodeElementHighlight in gpu-elements.ts:
// slot 0, elementPickId 4, padding 8, color 16, emissive 32, padding 36.
struct ElementHighlight {
  slot: u32,
  elementPickId: u32,
  _padding: vec2<u32>,
  color: vec4<f32>,
  emissive: f32,
  _padding2: vec3<f32>,
};

// records starts at byte offset 16 to keep the 16-byte element alignment;
// matches HIGHLIGHT_HEADER in gpu-elements.ts.
struct ElementHighlights {
  count: u32,
  _padding: vec3<u32>,
  records: array<ElementHighlight, 128>,
};

@group(0) @binding(0) var<uniform> camera: Camera;
@group(1) @binding(0) var<storage, read> instances: array<Instance>;
@group(1) @binding(1) var<storage, read> drawOrder: array<u32>;
@group(1) @binding(2) var<storage, read> triangleElementPickIds: array<u32>;
@group(1) @binding(3) var<storage, read> elementHighlights: ElementHighlights;

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec4<f32>,
  @location(1) @interpolate(flat) pickId: u32,
  @location(2) @interpolate(flat) emissive: f32,
  @location(3) @interpolate(flat) elementPickId: u32,
};

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
  output.position = camera.viewProjection * instance.transform * vec4<f32>(position, 1.0);
  output.color = color;
  output.pickId = instance.pickId;
  output.emissive = emissive;
  output.elementPickId = elementPickId;
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
struct Camera {
  viewProjection: mat4x4<f32>,
};

struct Instance {
  transform: mat4x4<f32>,
  color: vec4<f32>,
  pickId: u32,
  emissive: f32,
  _padding: vec2<u32>,
};

@group(0) @binding(0) var<uniform> camera: Camera;
@group(1) @binding(0) var<storage, read> instances: array<Instance>;
@group(1) @binding(1) var<storage, read> drawOrder: array<u32>;

struct EdgeOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec4<f32>,
  @location(2) @interpolate(flat) emissive: f32,
};

@vertex
fn vertexMain(@location(0) position: vec3<f32>, @builtin(instance_index) instanceIndex: u32) -> EdgeOutput {
  let instance = instances[drawOrder[instanceIndex]];
  var output: EdgeOutput;
  output.position = camera.viewProjection * instance.transform * vec4<f32>(position, 1.0);
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
