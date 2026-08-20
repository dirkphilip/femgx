import { expect, it, describe } from "vitest";
import { displayedColorFunction, resultColorFunctions } from "@/renderer/shaders/scene";
import {
  EMISSIVE_BYTE_OFFSET,
  INSTANCE_STRIDE,
  LINE_WIDTH_BYTE_OFFSET,
  ELEMENT_RECORD_STRIDE,
  HIGHLIGHT_HEADER,
  CAMERA_UNIFORM_SIZE,
  colorFragmentShader,
  edgeFragmentShader,
  surfaceLightingFunction,
  triangleColorFragmentShader,
  vertexOutput,
  edgeVertexShader,
  instanceVertexShader,
  pointVertexShader,
  lineNodePickVertexShader,
  nodePickFragmentShader,
  nodePickVertexShader,
  pointNodePickVertexShader,
  nodeOverlayFragmentShader,
  transparencyFragmentShader,
  triangleTransparencyFragmentShader,
  selectionFragmentShader,
  selectionTransparencyFragmentShader,
  normalizedDerivativeNormal,
  viewFacingSurfaceLighting,
  structInfo,
  memberOffsets,
  vertexShaders,
} from "./support";

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
    expect(instanceVertexShader).toContain("highlight.keepsResultColor");
    expect(instanceVertexShader).toContain(
      "if (!highlight.keepsResultColor) { color = highlight.color; }",
    );
    expect(instanceVertexShader).toContain("color = highlight.color;");
  });

  it("keeps dense selection color above active scalar results", () => {
    expect(instanceVertexShader).toContain("(elementHighlights.selectionFlags & 1u) != 0u");
    expect(triangleColorFragmentShader).not.toMatch(/@builtin\(frag_depth\)/);
  });

  it("keeps selected instance color above active scalar results", () => {
    for (const source of [instanceVertexShader, pointVertexShader]) {
      expect(source).toContain("color = instance.color;");
      expect(source).toContain("resultColorEnabled = false;");
    }
  });

  it("tests dense node membership for point and node-overlay vertices", () => {
    expect(pointVertexShader).toContain("denseNodeSelected(drawOrder[instanceIndex], nodePickId)");
    expect(pointVertexShader).toContain("nodeOverlayVertexMain");
    expect(pointVertexShader).toContain("elementHighlights.nodeSelectionBitsWord");
    expect(
      pointVertexShader.indexOf(
        "let denseNode = denseNodeSelected(drawOrder[instanceIndex], nodePickId)",
      ),
    ).toBeGreaterThan(
      pointVertexShader.indexOf("if (instanceHasPrimitiveEmphasis(instance.selected))"),
    );
  });

  it("applies dense node styling after body and element styling", () => {
    const denseNode = pointVertexShader.indexOf("if (denseNode) {");
    const denseElement = pointVertexShader.indexOf("denseElementSelected(");
    const sparseNode = pointVertexShader.indexOf("highlight.nodePickId == nodePickId");
    expect(denseElement).toBeGreaterThanOrEqual(0);
    expect(denseNode).toBeGreaterThan(denseElement);
    expect(sparseNode).toBeGreaterThan(denseNode);
    expect(pointVertexShader).toContain(
      "if (nodeOverlay && (elementHighlights.selectionFlags & 3u) != 0u)",
    );
    expect(pointVertexShader).not.toContain("instanceSelected(instance.selected) || denseNode");
    expect(pointVertexShader).toContain("color = instance.color;");
    expect(pointVertexShader).toContain("emissive = instance.emissive;");
  });

  it("keeps the black node overlay base for emissive-only dense selection", () => {
    expect(pointVertexShader).toContain(
      "if (nodeOverlay && (elementHighlights.selectionFlags & 3u) != 0u)",
    );
    expect(pointVertexShader).toContain("vec4<f32>(0.0, 0.0, 0.0, 0.45 * instance.color.a)");
  });

  it("composes result alpha with the resolved instance alpha", () => {
    expect(resultColorFunctions).toContain("resultColors[base + 3u] * fallback.a");
    expect(resultColorFunctions).toContain("resultColors[base]");
    expect(resultColorFunctions).toContain("resultColors[base + 1u]");
    expect(resultColorFunctions).toContain("resultColors[base + 2u]");
  });

  it("does not globally re-enable results after an element override disables them", () => {
    expect(instanceVertexShader).not.toContain("selectionKeepsResult");
    expect(instanceVertexShader).toContain(
      "resultColorEnabled = select(\n          false,\n          resultColorActive(drawOrder[instanceIndex], nodePickId, elementOrdinal),\n          highlight.keepsResultColor,\n        );",
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
    expect(nodePickVertexShader).toContain("vertexNodePickIds[geometrySourceIndex(base + 2u)]");
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
    expect(nodePickVertexShader).toMatch(/geometryPositionVec\(geometrySourceIndex\(base\)\)/);
    expect(nodePickVertexShader).toMatch(/vertexNodePickIds\[geometrySourceIndex\(base\)\]/);
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

  it("stabilizes interpolated result alpha before opaque and transparent classification", () => {
    expect(displayedColorFunction).toContain("alpha <= 1e-5");
    expect(displayedColorFunction).toContain("nonzeroAlpha >= 1.0 - 1e-5");
    for (const shader of [
      colorFragmentShader,
      triangleColorFragmentShader,
      transparencyFragmentShader,
      triangleTransparencyFragmentShader,
    ]) {
      expect(shader).toContain("resolvedDisplayedColor(");
    }
    expect(vertexOutput).toContain("@location(10) resultColor: vec4<f32>");
    expect(vertexOutput).not.toContain("@location(10) @interpolate(flat) resultColor");
  });

  it("lights only triangle surfaces from displayed world-space derivatives", () => {
    expect(triangleColorFragmentShader).toContain("@location(8) worldPosition: vec3<f32>");
    expect(triangleColorFragmentShader).toContain("@location(9) @interpolate(flat) selected: u32");
    expect(triangleColorFragmentShader).toContain("surfaceLighting(");
    expect(surfaceLightingFunction).toContain(
      "select(-normal, normal, dot(normal, viewer) >= 0.0)",
    );
    expect(surfaceLightingFunction).toContain("clamp(dot(facingNormal, light), 0.0, 1.0)");
    expect(surfaceLightingFunction).not.toContain("abs(dot(");
    expect(surfaceLightingFunction).toContain("SURFACE_SPECULAR_STRENGTH");
    expect(triangleColorFragmentShader).toContain("resolvedColor + vec3<f32>(emissive)");
    expect(triangleColorFragmentShader).toContain("displayedColor.a");
    expect(triangleColorFragmentShader).toContain("let litColor = surfaceLighting(");
    expect(triangleColorFragmentShader).toContain(
      "select(litColor, displayedColor.rgb, selected != 0u)",
    );
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
    expect(triangleTransparencyFragmentShader).toContain(
      "@location(9) @interpolate(flat) selected: u32",
    );
    expect(triangleTransparencyFragmentShader).toContain("let litColor = surfaceLighting(");
    expect(triangleTransparencyFragmentShader).toContain(
      "select(litColor, displayedColor.rgb, selected != 0u)",
    );
    expect(triangleColorFragmentShader.match(/fn surfaceLighting\(/g)).toHaveLength(1);
    expect(triangleTransparencyFragmentShader.match(/fn surfaceLighting\(/g)).toHaveLength(1);
  });

  it("keeps the highlight neutral, bounded, and after surface lighting", () => {
    expect(surfaceLightingFunction).toContain("vec3<f32>(specular)");
    expect(surfaceLightingFunction).toContain("pow(clamp(halfResponse, 0.0, 1.0)");
    expect(triangleColorFragmentShader).toContain("resolvedColor + vec3<f32>(emissive)");
    expect(triangleTransparencyFragmentShader).toContain(
      "weightedSceneTransparency(\n    resolvedColor + vec3<f32>(emissive)",
    );
    expect(colorFragmentShader).not.toContain("surfaceLighting");
    expect(edgeFragmentShader).not.toContain("surfaceLighting");
    expect(nodeOverlayFragmentShader).not.toContain("surfaceLighting");
  });

  it("keeps the derivative normal invariant across scale and finite fallbacks", () => {
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

  it("keeps the highlight neutral, winding-independent, and absent for invalid normals", () => {
    const color: readonly [number, number, number] = [0.2, 0.4, 0.6];
    const front = viewFacingSurfaceLighting([0, 0, 1], color, [0, 0, 1], [0, 0, 1]);
    const back = viewFacingSurfaceLighting([0, 0, -1], color, [0, 0, 1], [0, 0, 1]);
    const side = viewFacingSurfaceLighting([1, 0, 0], color, [0, 0, 1], [0, 0, 1]);
    const invalid = viewFacingSurfaceLighting(undefined, color, [0, 0, 1], [0, 0, 1]);
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

  it("does not mirror the key light onto a view-facing surface turned away from it", () => {
    const color: readonly [number, number, number] = [0.2, 0.4, 0.6];
    const awayFromKey = viewFacingSurfaceLighting([0, -0.8, 0.6], color, [0, 1, 0.4], [0, 0, 1]);

    expect(awayFromKey[0]).toBeCloseTo(0.11);
    expect(awayFromKey[1]).toBeCloseTo(0.22);
    expect(awayFromKey[2]).toBeCloseTo(0.33);
  });
});
