import { cameraStruct } from "./gpu-shaders";
import { transparencyOutput } from "./gpu-transparency";

/** WGSL shared by the visible and weighted-ghost origin-triad pipelines. */
export const originTriadShader = /* wgsl */ `
${cameraStruct}
${transparencyOutput}

struct Triad {
  scale: f32,
  shaftRadius: f32,
  arrowLength: f32,
  arrowWidth: f32,
  hubRadius: f32,
  _padding: vec3<f32>,
};

@group(0) @binding(0) var<uniform> camera: Camera;
@group(1) @binding(0) var<uniform> triad: Triad;

struct Output {
  @builtin(position) position: vec4<f32>,
  @location(0) @interpolate(flat) color: vec4<f32>,
};

fn axisDirection(axis: u32) -> vec3<f32> {
  switch axis {
    case 0u: { return vec3<f32>(1., 0., 0.); }
    case 1u: { return vec3<f32>(0., 1., 0.); }
    default: { return vec3<f32>(0., 0., 1.); }
  }
}

fn axisColor(axis: u32) -> vec3<f32> {
  switch axis {
    case 0u: { return vec3<f32>(.95, .18, .16); }
    case 1u: { return vec3<f32>(.2, .82, .28); }
    default: { return vec3<f32>(.18, .42, .98); }
  }
}

fn sideDirection(axis: vec3<f32>) -> vec3<f32> {
  var reference = vec3<f32>(0., 1., 0.);
  if (abs(axis.y) > .9) { reference = vec3<f32>(1., 0., 0.); }
  var side = cross(axis, camera.viewDirection.xyz);
  if (length(side) < 1e-3) { side = cross(axis, reference); }
  return normalize(side);
}

fn axisPosition(axisIndex: u32, vertex: u32) -> vec3<f32> {
  let axis = axisDirection(axisIndex);
  let side = sideDirection(axis);
  let lineEnd = triad.scale - triad.arrowLength;
  let halfWidth = triad.shaftRadius;
  switch vertex {
    case 0u: { return side * halfWidth; }
    case 1u: { return axis * lineEnd + side * halfWidth; }
    case 2u: { return axis * lineEnd - side * halfWidth; }
    case 3u: { return side * halfWidth; }
    case 4u: { return axis * lineEnd - side * halfWidth; }
    case 5u: { return -side * halfWidth; }
    case 6u: { return axis * triad.scale; }
    case 7u: { return axis * lineEnd + side * triad.arrowWidth; }
    default: { return axis * lineEnd - side * triad.arrowWidth; }
  }
}

fn ringPoint(segment: u32) -> vec2<f32> {
  switch segment % 6u {
    case 0u: { return vec2<f32>(1., 0.); }
    case 1u: { return vec2<f32>(.5, .8660254); }
    case 2u: { return vec2<f32>(-.5, .8660254); }
    case 3u: { return vec2<f32>(-1., 0.); }
    case 4u: { return vec2<f32>(-.5, -.8660254); }
    default: { return vec2<f32>(.5, -.8660254); }
  }
}

fn hubPosition(vertex: u32) -> vec3<f32> {
  var reference = vec3<f32>(0., 1., 0.);
  if (abs(camera.viewDirection.y) > .9) { reference = vec3<f32>(1., 0., 0.); }
  let side = normalize(cross(camera.viewDirection.xyz, reference));
  let up = normalize(cross(side, camera.viewDirection.xyz));
  let segment = (vertex / 3u) % 6u;
  let corner = vertex % 3u;
  if (corner == 0u) { return vec3<f32>(0.); }
  let ring = ringPoint(segment + corner - 1u);
  return (side * ring.x + up * ring.y) * triad.hubRadius;
}

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> Output {
  let axisIndex = vertexIndex / 9u;
  let localIndex = vertexIndex % 9u;
  let local = select(hubPosition(vertexIndex - 27u), axisPosition(axisIndex, localIndex), vertexIndex < 27u);
  var output: Output;
  output.position = camera.viewProjection * vec4<f32>(local, 1.);
  output.color = select(vec4<f32>(1.), vec4<f32>(axisColor(axisIndex), 1.), vertexIndex < 27u);
  return output;
}

@fragment
fn visibleFragmentMain(input: Output) -> @location(0) vec4<f32> {
  return input.color;
}

@fragment
fn hiddenFragmentMain(input: Output) -> TransparencyOutput {
  return weightedTransparency(input.color.rgb, .25);
}
`;
