import { describe, expect, it } from "vitest";
import { WgslReflect, type StructInfo } from "wgsl_reflect";
import {
  EMISSIVE_BYTE_OFFSET,
  INSTANCE_STRIDE,
  LINE_WIDTH_BYTE_OFFSET,
} from "../../src/renderer/gpu-draw";
import { ELEMENT_RECORD_STRIDE, HIGHLIGHT_HEADER } from "../../src/renderer/gpu-elements";
import { CAMERA_UNIFORM_SIZE } from "../../src/renderer/gpu-pipelines";
import { DEFORMATION_UNIFORM_SIZE } from "../../src/renderer/gpu-deform";
import {
  colorFragmentShader,
  edgeFragmentShader,
  edgeVertexShader,
  surfaceLightingFunction,
  triangleColorFragmentShader,
  vertexOutput,
} from "../../src/renderer/gpu-shaders";
import {
  instanceVertexShader,
  lineSelectionVertexShader,
  lineVertexShader,
  pointVertexShader,
  selectionVertexShader,
} from "../../src/renderer/gpu-instanced-shaders";
import { ownerVisibilityBindings } from "../../src/renderer/gpu-topology-shader";
import { BLOCK_HIGHLIGHT_MARKER } from "../../src/renderer/gpu-highlight-table";
import {
  lineNodePickVertexShader,
  nodePickFragmentShader,
  nodePickVertexShader,
  pointNodePickVertexShader,
} from "../../src/renderer/gpu-node-pick";
import { nodeOverlayFragmentShader } from "../../src/renderer/gpu-node-overlay";
import { edgePickFragmentShader, edgePickVertexShader } from "../../src/renderer/gpu-edge-pick";
import {
  transparencyFragmentShader,
  triangleTransparencyFragmentShader,
} from "../../src/renderer/gpu-transparency";
import {
  selectionFragmentShader,
  selectionTransparencyFragmentShader,
  triangleSelectionFragmentShader,
} from "../../src/renderer/gpu-selection";

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
  ["lineVertexShader", lineVertexShader],
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
      expect(offsets.get("lineWidth")).toBe(LINE_WIDTH_BYTE_OFFSET);
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

  it("declares a packed payload at the header offset the CPU allocates", () => {
    const info = structInfo(instanceVertexShader, "ElementHighlights");
    const offsets = memberOffsets(info);
    expect(offsets.get("count")).toBe(0);
    expect(offsets.get("data")).toBe(HIGHLIGHT_HEADER);
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
      expect(offsets.get("nodeSize")).toBe(76);
      expect(offsets.get("devicePixelRatio")).toBe(80);
      expect(offsets.get("linePickSize")).toBe(84);
      expect(offsets.get("trianglePickSize")).toBe(88);
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

  it("keeps the displayed color for emissive-only primitive emphasis", () => {
    expect(instanceVertexShader).toContain("highlight.preservesDisplayedColor");
    expect(instanceVertexShader).toContain(
      "if (!highlight.preservesDisplayedColor) { color = highlight.color; }",
    );
  });

  it("keeps the section-plane uniform out of shared vertex bindings", () => {
    expect(nodePickVertexShader).not.toMatch(/binding\(2\).*sectionPlane/);
    expect(triangleColorFragmentShader).toMatch(/binding\(2\).*sectionPlane/);
  });

  it("overrides triangle colors from the emphasis records", () => {
    expect(instanceVertexShader).not.toMatch(/\bvar match\b/);
    expect(instanceVertexShader).toMatch(/primitiveElementId\(primitiveDrawId\(vertexIndex\)\)/);
    expect(instanceVertexShader).toMatch(
      /primitiveFaceBodyPickIds\(primitiveDrawId\(vertexIndex\)\)/,
    );
    expect(instanceVertexShader).toMatch(/highlightHash\(/);
    expect(instanceVertexShader).toMatch(/elementHighlightAt\(base \+ offset\)/);
    expect(instanceVertexShader).toMatch(/denseElementSelected\(/);
    expect(instanceVertexShader).not.toMatch(/index < elementHighlights\.count/);
    expect(instanceVertexShader).not.toMatch(/highlight\.nodePickId/);
    expect(pointVertexShader).toMatch(/highlight\.nodePickId == nodePickId/);
    expect(instanceVertexShader).toMatch(/@location\(3\) @interpolate\(flat\) elementPickId: u32/);
    expect(instanceVertexShader).toMatch(/@location\(4\) @interpolate\(flat\) facePickId: u32/);
    expect(edgeVertexShader).toMatch(/topologyBodyRange\(topologyIndex\)/);
    expect(edgeVertexShader).toMatch(/highlight\.hidden == 0u/);
    expect(edgeVertexShader).toMatch(/topologyOwnersVisible\(/);
    expect(pointVertexShader).toMatch(/topologyAnyOwnerVisible\(/);
    expect(nodePickVertexShader).toMatch(/primitiveVisible\(/);
    expect(lineNodePickVertexShader).toMatch(/primitiveVisible\(/);
    expect(pointNodePickVertexShader).toMatch(/topologyAnyOwnerVisible\(/);
    expect(nodePickVertexShader).not.toMatch(/highlightHash\(drawOrder\[instanceIndex\]/);
    expect(pointNodePickVertexShader).not.toMatch(/highlightHash\(drawOrder\[instanceIndex\]/);
  });

  it("guards primitive emphasis probes with per-occurrence admission", () => {
    expect(instanceVertexShader).toContain("instanceHasPrimitiveEmphasis(instance.selected)");
    expect(instanceVertexShader).toContain("instanceSelected(instance.selected)");
    expect(pointVertexShader).toContain("instanceHasPrimitiveEmphasis(instance.selected)");
    expect(pointVertexShader).toContain("instanceSelected(instance.selected)");
    expect(edgeVertexShader).toContain("instanceHasPrimitiveEmphasis(instances[slot].selected)");
    expect(nodePickVertexShader).toContain(
      "instanceHasPrimitiveEmphasis(instances[slot].selected)",
    );
  });

  it("uses explicit primitive maps for indexed surfaces and shared sprite corners", () => {
    expect(instanceVertexShader).toContain("primitiveDrawId(vertexIndex)");
    expect(instanceVertexShader).not.toContain("vertexIndex / 3u");
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
      "worldPosition",
    ]);
    expect(nodePickVertexShader).toMatch(/@location\(5\) localPosition: vec3<f32>/);
    expect(nodePickVertexShader).toMatch(
      /@location\(9\) @interpolate\(flat\) nodePickIds: vec3<u32>/,
    );
    expect(nodePickVertexShader).toMatch(/@location\(10\) worldPosition: vec3<f32>/);
    expect(nodePickVertexShader).toMatch(/geometryPositions: array<f32>/);
    expect(nodePickVertexShader).toMatch(/geometryPosition\(base3\)/);
    expect(nodePickVertexShader).toMatch(/vertexNodePickIds\[base\]/);
    expect(nodePickFragmentShader).toMatch(
      /nearestNode\(localPosition, cornerA, cornerB, cornerC, nodePickIds\)/,
    );
    expect(nodePickFragmentShader).toMatch(/edgeScale \* 0\.04/);
    expect(nodePickFragmentShader).toMatch(/sectionPlaneVisible\(worldPosition\)/);
    expect(nodePickFragmentShader).toMatch(/bestDist > threshold/);
    expect(lineNodePickVertexShader).toMatch(/let base = \(vertexIndex - \(vertexIndex % 4u\)\)/);
    expect(lineNodePickVertexShader).toMatch(/primitiveDrawId\(vertexIndex\)/);
    expect(lineNodePickVertexShader).toMatch(/vertexNodePickIds\[base \+ 1u\]/);
    expect(lineNodePickVertexShader).toMatch(/lineExpandedPosition\(/);
    expect(pointNodePickVertexShader).toMatch(/primitiveElementId\(vertexIndex \/ 4u\)/);
    expect(pointNodePickVertexShader).toMatch(/output\.nodePickIds = vec3<u32>/);
  });

  it("keeps depth out of the bounded node-pick color attachments", () => {
    expect(nodePickFragmentShader).not.toMatch(/@location\(4\) displayedDepth/);
    expect(nodePickFragmentShader).not.toMatch(/@builtin\(position\) fragmentPosition/);
  });

  it("applies emissive additively in the color fragment shader", () => {
    expect(colorFragmentShader).toMatch(/@location\(2\) @interpolate\(flat\) emissive: f32/);
    expect(colorFragmentShader).toMatch(/displayedColor\.rgb \+ vec3<f32>\(emissive\)/);
    expect(colorFragmentShader).toContain("displayedColor.a < 1.0");
  });

  it("clips every scene fragment from the same deformed world position", () => {
    for (const shader of [
      colorFragmentShader,
      triangleColorFragmentShader,
      edgeFragmentShader,
      transparencyFragmentShader,
      triangleTransparencyFragmentShader,
      selectionFragmentShader,
      selectionTransparencyFragmentShader,
      nodeOverlayFragmentShader,
    ]) {
      expect(shader).toContain("sectionPlaneVisible(worldPosition)");
    }
    expect(edgeVertexShader).toContain("output.worldPosition");
    expect(pointVertexShader).toContain("output.worldPosition = worldPosition");
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
    expect(triangleColorFragmentShader).toContain("displayedColor.a");
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
      "weightedSceneTransparency(litColor + vec3<f32>(emissive), displayedColor.a, fragmentPosition.z)",
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

describe("selection emphasis shaders", () => {
  it("keeps the semantic block marker synchronized with both WGSL lookup sites", () => {
    const marker = `0x${BLOCK_HIGHLIGHT_MARKER.toString(16)}u`;
    expect(instanceVertexShader).toContain(marker);
    expect(ownerVisibilityBindings).toContain(marker);
  });

  it("bypasses neighbor suppression only for exact element and face selection", () => {
    expect(instanceVertexShader).toContain("primitiveVisible(drawOrder[instanceIndex]");
    expect(instanceVertexShader).not.toContain("if (!primitiveSelectionVisible");
    expect(selectionVertexShader).toContain("primitiveSelectionVisible(drawOrder[instanceIndex]");
    expect(selectionVertexShader).toContain(
      "exactSelection = exactSelection || highlight.selected",
    );
  });

  it("lights selected triangle surfaces while keeping line and point cues unlit", () => {
    for (const source of [selectionFragmentShader, triangleSelectionFragmentShader]) {
      expect(source).toContain("color.a <= 0.0");
      expect(source).toContain("visibleSelectionAlpha(color.a)");
    }
    expect(triangleSelectionFragmentShader).toContain("surfaceLighting(");
    expect(selectionFragmentShader).not.toContain("surfaceLighting(");
  });

  it("keeps result colors available in visible and hidden selection passes", () => {
    for (const source of [selectionFragmentShader, selectionTransparencyFragmentShader]) {
      expect(source).toContain("@location(10) resultColor: vec4<f32>");
      expect(source).toContain("resultColorEnabled: u32");
      expect(source).toContain("selectionColor(");
    }
  });
});

describe("GPU deformation shader contract", () => {
  it.each(vertexShaders)(
    "declares the legal 16-byte Deformation uniform layout in %s",
    (_name, source) => {
      const info = structInfo(source, "Deformation");
      const offsets = memberOffsets(info);
      expect(info.members.map((member) => member.name)).toEqual([
        "scale",
        "_padding0",
        "_padding1",
        "_padding2",
      ]);
      expect(offsets.get("scale")).toBe(0);
      expect(offsets.get("_padding0")).toBe(4);
      expect(offsets.get("_padding1")).toBe(8);
      expect(offsets.get("_padding2")).toBe(12);
      expect(info.members.map((member) => member.type.name)).toEqual(["f32", "u32", "u32", "u32"]);
      expect(info.size).toBe(DEFORMATION_UNIFORM_SIZE);
      expect(source).not.toContain("array<u32, 3>");
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
    expect(instanceVertexShader).toMatch(/fn primitiveDrawId\(index: u32\)/);
    expect(instanceVertexShader).not.toMatch(/vertexIndex \/ [23]u/);
  });

  it("resolves each vertex to its node before reading the displacement buffer", () => {
    expect(instanceVertexShader).toMatch(/vertexNodePickIds\[vertexIndex\]/);
    expect(instanceVertexShader).toMatch(/displacementCount == 0u/);
    expect(instanceVertexShader).toMatch(/arrayLength\(&displacements\)/);
    expect(instanceVertexShader).toMatch(/nodePickId == 0u \|\| nodePickId > nodeCount/);
    expect(instanceVertexShader).toMatch(/\(nodePickId - 1u\) \* 3u/);
    expect(instanceVertexShader).toMatch(/delta \* deformation\.scale/);
  });

  it("displaces point sprites by the vertex index, which carries the point's node", () => {
    expect(pointVertexShader).toMatch(/displaced\(position, vertexIndex\)/);
  });

  it("keeps node emphasis on the node glyph instead of recoloring surface triangles", () => {
    expect(instanceVertexShader).not.toMatch(/highlight\.nodePickId/);
    expect(pointVertexShader).toMatch(/highlight\.nodePickId == nodePickId/);
    expect(pointVertexShader).toMatch(/if \(!nodeOverlay\) \{\s+if \(bodyPickId != 0u/);
  });

  it("keeps regular points at model depth and gives node annotations an independent size", () => {
    expect(pointVertexShader).toMatch(/pointVertex\(position, instanceIndex, vertexIndex, false\)/);
    expect(pointVertexShader).toMatch(
      /nodeOverlayVertexMain[\s\S]*pointVertex\(position, instanceIndex, vertexIndex, true\)/,
    );
    expect(pointVertexShader).toMatch(/select\(camera\.pointSize, camera\.nodeSize, nodeOverlay\)/);
    expect(pointVertexShader).toMatch(/clip\.z,/);
    expect(colorFragmentShader).toMatch(/dot\(local, local\) > 1\.0/);
  });

  it("draws circular node glyphs at model depth", () => {
    expect(pointVertexShader).toMatch(/output\.nodeDepth = clip\.z \/ clip\.w/);
    expect(nodeOverlayFragmentShader).toMatch(/dot\(local, local\) > 1\.0/);
    expect(nodeOverlayFragmentShader).toMatch(/selected != 0u \|\| emissive > 0\.0/);
    expect(nodeOverlayFragmentShader).toMatch(/select\(vec3<f32>\(0\.0\), color\.rgb/);
  });

  it("keeps a shared node visible when hiding one incident element exposes it", () => {
    expect(pointVertexShader).toMatch(
      /nodeOverlay && !topologyAnyOwnerVisible\(drawOrder\[instanceIndex\], vertexIndex \/ 4u\)/,
    );
    expect(pointVertexShader).toMatch(
      /fn topologyAnyOwnerVisible[\s\S]*if \(ownerVisible[\s\S]*return true;/,
    );
    expect(pointVertexShader).not.toContain("topologyOwnersAllVisible");
  });

  it("uses the minimum point-pick diameter independently of visible point size", () => {
    expect(pointNodePickVertexShader).toMatch(
      /max\(camera\.pointSize, 8\.0 \* camera\.devicePixelRatio\)/,
    );
  });

  it("expands only subpixel triangles in pick and selected feedback passes", () => {
    expect(nodePickVertexShader).toContain("trianglePickPosition(");
    expect(nodePickVertexShader).toContain("camera.trianglePickSize");
    expect(selectionVertexShader).toContain("trianglePickPosition(");
    expect(instanceVertexShader).not.toContain("trianglePickPosition(");
  });

  it("keeps expanded selected triangles in their occurrence transform", () => {
    expect(selectionVertexShader).toMatch(
      /let triangleCenterClip = camera\.viewProjection \* instance\.transform/,
    );
    expect(selectionVertexShader).toMatch(
      /trianglePickPosition\([\s\S]*triangleCenterClip,[\s\S]*vertexIndex % 3u/,
    );
  });

  it("keeps expanded triangle node picks in their occurrence transform", () => {
    expect(nodePickVertexShader).toMatch(
      /let triangleCenterClip = camera\.viewProjection \* instance\.transform/,
    );
    expect(nodePickVertexShader).toMatch(
      /trianglePickPosition\([\s\S]*triangleCenterClip,[\s\S]*vertexIndex % 3u/,
    );
  });

  it("uses resolved instance opacity for neutral node and edge overlays", () => {
    expect(pointVertexShader).toContain("var color = select(");
    expect(pointVertexShader).toContain("vec4<f32>(0.0, 0.0, 0.0, 0.45 * instance.color.a)");
    expect(pointVertexShader).toContain("nodeOverlay,");
    expect(pointVertexShader).toMatch(
      /pointVertexMain[\s\S]*pointVertex\(position, instanceIndex, vertexIndex, false\)/,
    );
    expect(edgeVertexShader).toMatch(
      /output\.color = vec4<f32>\(0\.0, 0\.0, 0\.0, 0\.45 \* instance\.color\.a\)/,
    );
    expect(edgeVertexShader).toMatch(/output\.emissive = 0\.0/);
  });

  it("displaces expanded edge endpoints through their draw index", () => {
    expect(edgeVertexShader).toMatch(/let topologyIndex = edgeId\(vertexIndex\)/);
    expect(edgeVertexShader).toMatch(/displaced\(position, vertexIndex\)/);
    expect(edgeVertexShader).toMatch(/topologyOwnersVisible\(slot, topologyIndex\)/);
  });

  it("keeps authored-edge picking exact, section-aware, and visibility-aware", () => {
    expect(edgePickVertexShader).toContain("struct ElementHighlights");
    expect(edgePickVertexShader).toContain("fn highlightHash(");
    expect(edgePickVertexShader).toContain("camera.linePickSize * camera.devicePixelRatio");
    expect(edgePickVertexShader).toContain("topologyAnyOwnerVisible");
    expect(edgePickVertexShader).toContain("output.edgePickId = edgeId(vertexIndex) + 1u");
    expect(edgePickFragmentShader).toContain("sectionPlaneVisible(worldPosition)");
    expect(edgePickFragmentShader).toContain("return packPickId(edgePickId)");
  });

  it("expands authored lines in screen space while preserving the line-list edge shader", () => {
    expect(lineVertexShader).toContain("lineExpandedPosition(");
    expect(lineVertexShader).toContain("instance.lineWidth * camera.devicePixelRatio");
    expect(lineSelectionVertexShader).toContain("primitiveSelectionVisible");
    expect(lineVertexShader).not.toContain("primitive: line-list");
    expect(lineNodePickVertexShader).toContain(
      "max(instance.lineWidth, camera.linePickSize) * camera.devicePixelRatio",
    );
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
