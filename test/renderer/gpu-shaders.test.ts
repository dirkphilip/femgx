import { describe, expect, it } from "vitest";
import { WgslReflect, type StructInfo } from "wgsl_reflect";
import { EMISSIVE_BYTE_OFFSET, INSTANCE_STRIDE } from "../../src/renderer/gpu-draw";
import { ELEMENT_RECORD_STRIDE, HIGHLIGHT_HEADER } from "../../src/renderer/gpu-elements";
import { CAMERA_UNIFORM_SIZE } from "../../src/renderer/gpu-pipelines";
import { DEFORMATION_UNIFORM_SIZE } from "../../src/renderer/gpu-deform";
import {
  colorFragmentShader,
  edgeFragmentShader,
  edgeVertexShader,
  pickFragmentShader,
  triangleColorFragmentShader,
} from "../../src/renderer/gpu-shaders";
import {
  instanceVertexShader,
  lineVertexShader,
  pointVertexShader,
} from "../../src/renderer/gpu-instanced-shaders";
import {
  lineNodePickVertexShader,
  nodePickFragmentShader,
  nodePickVertexShader,
  pointNodePickVertexShader,
} from "../../src/renderer/gpu-node-pick";
import { nodeOverlayFragmentShader } from "../../src/renderer/gpu-node-overlay";

/** Returns the named struct's layout as computed by the wgsl_reflect parser. */
function structInfo(source: string, name: string): StructInfo {
  const info = new WgslReflect(source).getStructInfo(name);
  if (info === null) throw new Error(`struct ${name} not found in shader`);
  return info;
}

/** Maps a struct's members to their byte offsets under WGSL layout rules. */
function memberOffsets(info: StructInfo): ReadonlyMap<string, number> {
  return new Map(info.members.map((member) => [member.name, member.offset]));
}

/** Vertex shaders that embed the shared camera and instance record structs. */
const vertexShaders = [
  ["instanceVertexShader", instanceVertexShader],
  ["pointVertexShader", pointVertexShader],
  ["edgeVertexShader", edgeVertexShader],
] as const;

describe("GPU record struct layout vs CPU record encoders", () => {
  it.each(vertexShaders)(
    "keeps the Instance record layout aligned with encodeInstanceRecord in %s",
    (_name, source) => {
      const info = structInfo(source, "Instance");
      const offsets = memberOffsets(info);
      expect(offsets.get("transform")).toBe(0);
      expect(offsets.get("color")).toBe(64);
      expect(offsets.get("pickId")).toBe(80);
      expect(offsets.get("emissive")).toBe(EMISSIVE_BYTE_OFFSET);
      expect(info.size).toBe(INSTANCE_STRIDE);
    },
  );

  it("keeps ElementHighlight records aligned with encodeEmphasisRecord", () => {
    const info = structInfo(instanceVertexShader, "ElementHighlight");
    const offsets = memberOffsets(info);
    expect(offsets.get("slot")).toBe(0);
    expect(offsets.get("elementPickId")).toBe(4);
    expect(offsets.get("facePickId")).toBe(8);
    expect(offsets.get("nodePickId")).toBe(12);
    expect(offsets.get("color")).toBe(16);
    expect(offsets.get("emissive")).toBe(32);
    expect(info.size).toBe(ELEMENT_RECORD_STRIDE);
  });

  it("declares a runtime-sized records array at the header offset the CPU allocates", () => {
    const info = structInfo(instanceVertexShader, "ElementHighlights");
    const offsets = memberOffsets(info);
    expect(offsets.get("count")).toBe(0);
    expect(offsets.get("records")).toBe(HIGHLIGHT_HEADER);
    expect(info.size).toBe(HIGHLIGHT_HEADER);
  });

  it.each(vertexShaders)(
    "keeps the Camera uniform layout aligned with frame encoding in %s",
    (_name, source) => {
      const info = structInfo(source, "Camera");
      const offsets = memberOffsets(info);
      expect(offsets.get("viewProjection")).toBe(0);
      expect(offsets.get("viewport")).toBe(64);
      expect(offsets.get("pointSize")).toBe(72);
      expect(offsets.get("nearPlane")).toBe(76);
      expect(offsets.get("farPlane")).toBe(80);
      expect(offsets.get("ortho")).toBe(84);
      expect(offsets.get("depthSlack")).toBe(88);
      expect(offsets.get("keyLightDirection")).toBe(96);
      expect(info.size).toBe(CAMERA_UNIFORM_SIZE);
    },
  );

  it("passes the per-instance emissive to the fragment stage", () => {
    const output = structInfo(instanceVertexShader, "VertexOutput");
    expect(output.members.find((member) => member.name === "emissive")?.type.name).toBe("f32");
    expect(instanceVertexShader).toMatch(/@location\(2\) @interpolate\(flat\) emissive: f32/);
    expect(instanceVertexShader).toMatch(/output\.emissive = emissive;/);
  });

  it("overrides triangle colors from the emphasis records", () => {
    expect(instanceVertexShader).not.toMatch(/\bvar match\b/);
    expect(instanceVertexShader).toMatch(/primitiveElementPickIds\[vertexIndex \/ 3u\]/);
    expect(instanceVertexShader).toMatch(/primitiveFaceBodyPickIds\(vertexIndex \/ 3u\)/);
    expect(instanceVertexShader).toMatch(/highlightHash\(/);
    expect(instanceVertexShader).toMatch(/elementHighlights\.records\[base \+ offset\]/);
    expect(instanceVertexShader).not.toMatch(/index < elementHighlights\.count/);
    expect(instanceVertexShader).not.toMatch(/highlight\.nodePickId/);
    expect(pointVertexShader).toMatch(/highlight\.nodePickId == nodePickId/);
    expect(instanceVertexShader).toMatch(/@location\(3\) @interpolate\(flat\) elementPickId: u32/);
    expect(instanceVertexShader).toMatch(/@location\(4\) @interpolate\(flat\) facePickId: u32/);
    expect(lineVertexShader).toMatch(/primitiveElementPickIds\[vertexIndex \/ 2u\]/);
    expect(lineVertexShader).toMatch(/primitiveFaceBodyPickIds\(vertexIndex \/ 2u\)/);
    expect(edgeVertexShader).toMatch(/topologyBodyRange\(topologyIndex\)/);
    expect(edgeVertexShader).toMatch(/highlight\.hidden == 0u/);
    expect(pointVertexShader).toMatch(/topologyBodyVisible\(/);
  });

  it("reports a proximity-gated nearest corner node in the node pick pass", () => {
    const memberNames = structInfo(nodePickVertexShader, "NodeVertexOutput").members.map(
      (member) => member.name,
    );
    expect(memberNames).toEqual([
      "position",
      "color",
      "pickId",
      "emissive",
      "elementPickId",
      "facePickId",
      "localPosition",
      "cornerA",
      "cornerB",
      "cornerC",
      "nodePickIds",
    ]);
    expect(nodePickVertexShader).toMatch(/@location\(5\) localPosition: vec3<f32>/);
    expect(nodePickVertexShader).toMatch(
      /@location\(9\) @interpolate\(flat\) nodePickIds: vec3<u32>/,
    );
    expect(nodePickVertexShader).toMatch(/positions: array<f32>/);
    expect(nodePickVertexShader).toMatch(/positions\[base3\]/);
    expect(nodePickVertexShader).toMatch(/vertexNodePickIds\[base\]/);
    expect(nodePickFragmentShader).toMatch(
      /nearestNode\(localPosition, cornerA, cornerB, cornerC, nodePickIds\)/,
    );
    expect(nodePickFragmentShader).toMatch(/edgeScale \* 0\.04/);
    expect(nodePickFragmentShader).toMatch(/bestDist > threshold/);
    expect(lineNodePickVertexShader).toMatch(/let base = \(vertexIndex \/ 2u\) \* 2u/);
    expect(lineNodePickVertexShader).toMatch(/vertexNodePickIds\[base \+ 1u\]/);
    expect(lineNodePickVertexShader).not.toMatch(/positions\[base3 \+ 6u\]/);
    expect(pointNodePickVertexShader).toMatch(/primitiveElementPickIds\[vertexIndex \/ 4u\]/);
    expect(pointNodePickVertexShader).toMatch(/output\.nodePickIds = vec3<u32>/);
  });

  it.each([pickFragmentShader, nodePickFragmentShader])(
    "keeps depth out of the bounded pick color attachments",
    (shader) => {
      expect(shader).not.toMatch(/@location\(4\) displayedDepth/);
      expect(shader).not.toMatch(/@builtin\(position\) fragmentPosition/);
    },
  );

  it("applies emissive additively in the color fragment shader", () => {
    expect(colorFragmentShader).toMatch(/@location\(2\) @interpolate\(flat\) emissive: f32/);
    expect(colorFragmentShader).toMatch(/color\.rgb \+ vec3<f32>\(emissive\)/);
  });

  it("lights only triangle surfaces from displayed world-space derivatives", () => {
    expect(triangleColorFragmentShader).toContain("@location(8) worldPosition: vec3<f32>");
    expect(triangleColorFragmentShader).toContain(
      "cross(dpdx(worldPosition), dpdy(worldPosition))",
    );
    expect(triangleColorFragmentShader).toContain(
      "abs(dot(normal, normalize(camera.keyLightDirection.xyz)))",
    );
    expect(triangleColorFragmentShader).toContain(
      "normalLength == normalLength && normalLength > 1e-6 && normalLength < 1e20",
    );
    expect(triangleColorFragmentShader).toContain("color.rgb * diffuse + vec3<f32>(emissive)");
    expect(triangleColorFragmentShader).toContain("color.a");
    expect(colorFragmentShader).not.toContain("keyLightDirection");
    expect(colorFragmentShader).not.toContain("dpdx");
  });
});

describe("GPU deformation shader contract", () => {
  it.each(vertexShaders)(
    "declares the Deformation uniform at the offsets the CPU writes in %s",
    (_name, source) => {
      const info = structInfo(source, "Deformation");
      const offsets = memberOffsets(info);
      expect(offsets.get("scale")).toBe(0);
      expect(offsets.get("loadCase")).toBe(4);
      expect(offsets.get("loadCaseCount")).toBe(8);
      expect(info.size).toBe(DEFORMATION_UNIFORM_SIZE);
    },
  );

  it.each(vertexShaders)(
    "reads the deformation uniform, displacement storage, and node ids in %s",
    (_name, source) => {
      expect(source).toMatch(/@group\(0\) @binding\(1\) var<uniform> deformation: Deformation/);
      expect(source).toMatch(
        /@group\(1\) @binding\(4\) var<storage, read> displacements: array<f32>/,
      );
      expect(source).toMatch(
        /@group\(1\) @binding\(6\) var<storage, read> vertexNodePickIds: array<u32>/,
      );
      expect(source).toMatch(
        /@group\(1\) @binding\(5\) var<storage, read> topologyData: array<u32>/,
      );
      expect(source).toMatch(/fn displaced\(position: vec3<f32>, vertexIndex: u32\)/);
    },
  );

  it("displaces surface vertices by their vertex buffer index", () => {
    expect(instanceVertexShader).toMatch(/displaced\(position, vertexIndex\)/);
  });

  it("resolves each vertex to its node before reading the displacement buffer", () => {
    expect(instanceVertexShader).toMatch(/vertexNodePickIds\[vertexIndex\]/);
    expect(instanceVertexShader).toMatch(/deformation\.loadCaseCount == 0u/);
    expect(instanceVertexShader).toMatch(/arrayLength\(&displacements\)/);
    expect(instanceVertexShader).toMatch(/nodePickId == 0u \|\| nodePickId > nodeCount/);
    expect(instanceVertexShader).toMatch(/deformation\.loadCase \* nodeCount \+ nodePickId - 1u/);
    expect(instanceVertexShader).toMatch(/delta \* deformation\.scale/);
  });

  it("displaces point sprites by the vertex index, which carries the point's node", () => {
    expect(pointVertexShader).toMatch(/displaced\(position, vertexIndex\)/);
  });

  it("keeps node emphasis on the node glyph instead of recoloring surface triangles", () => {
    expect(instanceVertexShader).not.toMatch(/highlight\.nodePickId/);
    expect(pointVertexShader).toMatch(/highlight\.nodePickId == nodePickId/);
  });

  it("keeps regular points at model depth and draws node annotations smaller", () => {
    expect(pointVertexShader).toMatch(
      /pointVertex\(position, instanceIndex, vertexIndex, 1\.0, false\)/,
    );
    expect(pointVertexShader).toMatch(
      /nodeOverlayVertexMain[\s\S]*pointVertex\(position, instanceIndex, vertexIndex, 0\.75, true\)/,
    );
    expect(pointVertexShader).toMatch(/clip\.z,/);
    expect(colorFragmentShader).toMatch(/dot\(local, local\) > 1\.0/);
  });

  it("draws circular node glyphs at model depth", () => {
    expect(pointVertexShader).toMatch(/output\.nodeDepth = clip\.z \/ clip\.w/);
    expect(nodeOverlayFragmentShader).toMatch(/dot\(local, local\) > 1\.0/);
    expect(nodeOverlayFragmentShader).toMatch(/color\.rgb \+ vec3<f32>\(emissive\)/);
  });

  it("uses neutral black for element nodes and edges", () => {
    expect(pointVertexShader).toMatch(
      /var color = select\(instance\.color, vec4<f32>\(0\.0, 0\.0, 0\.0, 0\.45\), nodeOverlay\)/,
    );
    expect(pointVertexShader).toMatch(
      /pointVertexMain[\s\S]*pointVertex\(position, instanceIndex, vertexIndex, 1\.0, false\)/,
    );
    expect(edgeVertexShader).toMatch(/output\.color = vec4<f32>\(0\.0, 0\.0, 0\.0, 0\.45\)/);
    expect(edgeVertexShader).toMatch(/output\.emissive = 0\.0/);
  });

  it("displaces the edge overlay through the vertex buffer index", () => {
    expect(edgeVertexShader).toMatch(/@builtin\(vertex_index\) vertexIndex: u32/);
    expect(edgeVertexShader).toMatch(/displaced\(position, vertexIndex\)/);
  });

  it("keeps overlay vertices at their model depth", () => {
    expect(edgeVertexShader).not.toMatch(/clip\.z\s*-/);
    expect(edgeVertexShader).toContain(
      "output.position = camera.viewProjection * instance.transform",
    );
  });

  it("resolves coplanar line depth by one depth24 unit after rasterization", () => {
    expect(edgeFragmentShader).toMatch(/@builtin\(position\) fragmentPosition/);
    expect(edgeFragmentShader).toMatch(/@builtin\(frag_depth\) depth/);
    expect(edgeFragmentShader).toContain("fragmentPosition.z - 1.0 / 16777215.0");
  });
});
