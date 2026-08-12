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
  surfaceLightingFunction,
  pickFragmentShader,
  triangleColorFragmentShader,
  vertexOutput,
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
import {
  transparencyFragmentShader,
  triangleTransparencyFragmentShader,
} from "../../src/renderer/gpu-transparency";

function normalizedDerivativeNormal(
  first: readonly [number, number, number],
  second: readonly [number, number, number],
): readonly [number, number, number] | undefined {
  const firstScale = Math.max(...first.map(Math.abs));
  const secondScale = Math.max(...second.map(Math.abs));
  if (
    !Number.isFinite(firstScale) ||
    !Number.isFinite(secondScale) ||
    firstScale <= 0 ||
    secondScale <= 0
  ) {
    return undefined;
  }
  const a = first.map((value) => value / firstScale) as [number, number, number];
  const b = second.map((value) => value / secondScale) as [number, number, number];
  const normal: [number, number, number] = [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  const normalLength = Math.hypot(...normal);
  return Number.isFinite(normalLength) && normalLength > 1e-6
    ? (normal.map((value) => value / normalLength) as [number, number, number])
    : undefined;
}

function mirroredSurfaceLighting(
  normal: readonly [number, number, number] | undefined,
  baseColor: readonly [number, number, number],
  light: readonly [number, number, number],
  viewer: readonly [number, number, number],
): readonly [number, number, number] {
  const ambient = 0.55;
  const diffuseCoefficient = 0.35;
  const specularStrength = 0.14;
  const exponent = 48;
  if (normal === undefined) {
    return [baseColor[0] * ambient, baseColor[1] * ambient, baseColor[2] * ambient];
  }
  const unit = (value: readonly [number, number, number]): typeof value => {
    const length = Math.hypot(...value);
    return length > 1e-6 ? [value[0] / length, value[1] / length, value[2] / length] : [0, 0, 0];
  };
  const unitLight = unit(light);
  const unitViewer = unit(viewer);
  const half = unit([
    unitLight[0] + unitViewer[0],
    unitLight[1] + unitViewer[1],
    unitLight[2] + unitViewer[2],
  ]);
  const response = Math.abs(
    normal[0] * unitLight[0] + normal[1] * unitLight[1] + normal[2] * unitLight[2],
  );
  const halfResponse = Math.abs(normal[0] * half[0] + normal[1] * half[1] + normal[2] * half[2]);
  const diffuse = ambient + diffuseCoefficient * Math.min(1, response);
  const specular =
    Math.hypot(...half) > 0 ? specularStrength * Math.pow(Math.min(1, halfResponse), exponent) : 0;
  return [
    baseColor[0] * diffuse + specular,
    baseColor[1] * diffuse + specular,
    baseColor[2] * diffuse + specular,
  ];
}

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
      expect(offsets.get("viewDirection")).toBe(112);
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
    expect(pointVertexShader).toMatch(/topologyOwnersVisible\(/);
  });

  it("builds primitive variants from explicit indexing and shared sprite corners", () => {
    expect(instanceVertexShader).toContain("vertexIndex / 3u");
    expect(lineVertexShader).toContain("vertexIndex / 2u");
    expect(lineVertexShader).not.toContain("vertexIndex / 3u");
    expect(nodePickVertexShader).toContain("vertexNodePickIds[base + 2u]");
    expect(lineNodePickVertexShader).toContain("base + 1u");
    expect(lineNodePickVertexShader).not.toContain("vertexNodePickIds[base + 2u]");
    expect(pointVertexShader.match(/fn spriteCorner\(/g)).toHaveLength(1);
    expect(pointNodePickVertexShader.match(/fn spriteCorner\(/g)).toHaveLength(1);
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
    expect(nodePickVertexShader).toMatch(/geometryData: array<u32>/);
    expect(nodePickVertexShader).toMatch(/geometryPosition\(base3\)/);
    expect(nodePickVertexShader).toMatch(/vertexNodePickIds\[base\]/);
    expect(nodePickFragmentShader).toMatch(
      /nearestNode\(localPosition, cornerA, cornerB, cornerC, nodePickIds\)/,
    );
    expect(nodePickFragmentShader).toMatch(/edgeScale \* 0\.04/);
    expect(nodePickFragmentShader).toMatch(/bestDist > threshold/);
    expect(lineNodePickVertexShader).toMatch(/let base = \(vertexIndex \/ 2u\) \* 2u/);
    expect(lineNodePickVertexShader).toMatch(/vertexNodePickIds\[base \+ 1u\]/);
    expect(lineNodePickVertexShader).not.toMatch(/geometryPosition\(base3 \+ 6u\)/);
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
    expect(colorFragmentShader).toContain("color.a < 1.0");
  });

  it("keeps style alpha flat before exact opaque and transparent classification", () => {
    expect(vertexOutput).toContain("@location(0) @interpolate(flat) color: vec4<f32>");
    for (const shader of [
      colorFragmentShader,
      triangleColorFragmentShader,
      transparencyFragmentShader,
      triangleTransparencyFragmentShader,
      nodeOverlayFragmentShader,
    ]) {
      expect(shader).toContain("@location(0) @interpolate(flat) color: vec4<f32>");
    }
  });

  it("lights only triangle surfaces from displayed world-space derivatives", () => {
    expect(triangleColorFragmentShader).toContain("@location(8) worldPosition: vec3<f32>");
    expect(triangleColorFragmentShader).toContain("surfaceLighting(");
    expect(surfaceLightingFunction).toContain("abs(dot(normal, light))");
    expect(surfaceLightingFunction).toContain("SURFACE_SPECULAR_STRENGTH");
    expect(triangleColorFragmentShader).toContain("litColor + vec3<f32>(emissive)");
    expect(triangleColorFragmentShader).toContain("color.a");
    expect(colorFragmentShader).not.toContain("keyLightDirection");
    expect(colorFragmentShader).not.toContain("dpdx");
  });

  it("normalizes flat derivatives after scale normalization and shares the lighting helper", () => {
    expect(surfaceLightingFunction).toContain("normalizedFirst = first / firstScale");
    expect(surfaceLightingFunction).toContain("normalizedSecond = second / secondScale");
    expect(surfaceLightingFunction).toContain("return vec3<f32>(0.0)");
    expect(surfaceLightingFunction).toContain("return baseColor * SURFACE_AMBIENT");
    expect(surfaceLightingFunction).toContain("safeDirection(light + viewer)");
    expect(triangleColorFragmentShader).toContain(surfaceLightingFunction);
    expect(triangleTransparencyFragmentShader).toContain(surfaceLightingFunction);
    expect(triangleTransparencyFragmentShader).toContain("surfaceLighting(");
    expect(triangleColorFragmentShader.match(/fn surfaceLighting\(/g)).toHaveLength(1);
    expect(triangleTransparencyFragmentShader.match(/fn surfaceLighting\(/g)).toHaveLength(1);
  });

  it("keeps the highlight neutral, bounded, and after surface lighting", () => {
    expect(surfaceLightingFunction).toContain("vec3<f32>(specular)");
    expect(surfaceLightingFunction).toContain("pow(clamp(halfResponse, 0.0, 1.0)");
    expect(triangleColorFragmentShader).toContain("litColor + vec3<f32>(emissive)");
    expect(triangleTransparencyFragmentShader).toContain(
      "weightedTransparency(litColor + vec3<f32>(emissive), color.a)",
    );
    expect(colorFragmentShader).not.toContain("surfaceLighting");
    expect(edgeFragmentShader).not.toContain("surfaceLighting");
    expect(nodeOverlayFragmentShader).not.toContain("surfaceLighting");
  });

  it("keeps the mirrored derivative normal invariant across scale and finite fallbacks", () => {
    const base = normalizedDerivativeNormal([1, 0.25, 0], [0, 1, 0.5]);
    for (const scale of [1e-30, 1e-12, 1, 1e12, 1e30]) {
      const scaled = normalizedDerivativeNormal([scale, scale * 0.25, 0], [0, scale, scale * 0.5]);
      expect(scaled).toBeDefined();
      for (let index = 0; index < 3; index += 1) {
        expect(scaled?.[index]).toBeCloseTo(base?.[index] ?? NaN, 10);
      }
    }
    expect(normalizedDerivativeNormal([0, 0, 0], [1, 0, 0])).toBeUndefined();
    expect(normalizedDerivativeNormal([1, 0, 0], [2, 0, 0])).toBeUndefined();
    expect(normalizedDerivativeNormal([Number.NaN, 0, 0], [0, 1, 0])).toBeUndefined();
    expect(normalizedDerivativeNormal([Number.POSITIVE_INFINITY, 0, 0], [0, 1, 0])).toBeUndefined();
  });

  it("keeps the highlight neutral, two-sided, and absent for invalid normals", () => {
    const color: readonly [number, number, number] = [0.2, 0.4, 0.6];
    const front = mirroredSurfaceLighting([0, 0, 1], color, [0, 0, 1], [0, 0, 1]);
    const back = mirroredSurfaceLighting([0, 0, -1], color, [0, 0, 1], [0, 0, 1]);
    const side = mirroredSurfaceLighting([1, 0, 0], color, [0, 0, 1], [0, 0, 1]);
    const invalid = mirroredSurfaceLighting(undefined, color, [0, 0, 1], [0, 0, 1]);
    expect(back).toEqual(front);
    expect(front[0] - color[0] * 0.9).toBeCloseTo(front[1] - color[1] * 0.9, 12);
    expect(front[1] - color[1] * 0.9).toBeCloseTo(front[2] - color[2] * 0.9, 12);
    expect(side[0]).toBeCloseTo(0.11);
    expect(side[1]).toBeCloseTo(0.22);
    expect(side[2]).toBeCloseTo(0.33);
    expect(invalid[0]).toBeCloseTo(0.11);
    expect(invalid[1]).toBeCloseTo(0.22);
    expect(invalid[2]).toBeCloseTo(0.33);
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

  it("uses resolved instance opacity for neutral node and edge overlays", () => {
    expect(pointVertexShader).toContain("var color = select(");
    expect(pointVertexShader).toContain("vec4<f32>(0.0, 0.0, 0.0, 0.45 * instance.color.a)");
    expect(pointVertexShader).toContain("nodeOverlay,");
    expect(pointVertexShader).toMatch(
      /pointVertexMain[\s\S]*pointVertex\(position, instanceIndex, vertexIndex, 1\.0, false\)/,
    );
    expect(edgeVertexShader).toMatch(
      /output\.color = vec4<f32>\(0\.0, 0\.0, 0\.0, 0\.45 \* instance\.color\.a\)/,
    );
    expect(edgeVertexShader).toMatch(/output\.emissive = 0\.0/);
  });

  it("displaces edge endpoints through explicit source and logical ids", () => {
    expect(edgeVertexShader).toMatch(/let endpoint = edgeEndpoint\(vertexIndex\)/);
    expect(edgeVertexShader).toMatch(/let sourceVertexIndex = endpoint\.x/);
    expect(edgeVertexShader).toMatch(/let topologyIndex = endpoint\.y/);
    expect(edgeVertexShader).toMatch(/displaced\(position, sourceVertexIndex\)/);
    expect(edgeVertexShader).toMatch(/topologyOwnersVisible\(slot, topologyIndex\)/);
    expect(edgeVertexShader).not.toMatch(/topologyOwnersVisible\(slot, vertexIndex \/ 2u\)/);
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
