import { expect, it, describe } from "vitest";
import {
  DEFORMATION_UNIFORM_SIZE,
  colorFragmentShader,
  edgeFragmentShader,
  triangleColorFragmentShader,
  edgeVertexShader,
  instanceVertexShader,
  lineSelectionVertexShader,
  lineVertexShader,
  pointVertexShader,
  selectionVertexShader,
  lineNodePickVertexShader,
  nodePickVertexShader,
  pointNodePickVertexShader,
  nodeOverlayFragmentShader,
  edgePickFragmentShader,
  edgePickVertexShader,
  structInfo,
  memberOffsets,
  vertexShaders,
} from "./support";

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
    expect(nodeOverlayFragmentShader).toMatch(/radiusSquared > 1\.0/);
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

  it("expands subpixel triangles only for picking", () => {
    expect(nodePickVertexShader).toContain("trianglePickPosition(");
    expect(nodePickVertexShader).toContain("camera.trianglePickSize");
    expect(selectionVertexShader).not.toContain("trianglePickPosition(");
    expect(instanceVertexShader).not.toContain("trianglePickPosition(");
  });

  it("matches visible selected triangle depth to the ordinary surface position", () => {
    expect(selectionVertexShader).toContain(
      "let displayedPosition = displaced(position, vertexIndex)",
    );
    expect(selectionVertexShader).toContain(
      "let worldPosition = (instance.transform * vec4<f32>(displayedPosition, 1.0)).xyz",
    );
    expect(selectionVertexShader).toContain(
      "output.position = camera.viewProjection * vec4<f32>(worldPosition, 1.0)",
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

  it("draws visible authored-edge endpoints through the native line path", () => {
    expect(edgeVertexShader).toMatch(/let topologyIndex = edgeId\(vertexIndex\)/);
    expect(edgeVertexShader).toContain("geometryPosition(vertexIndex * 3u)");
    expect(edgeVertexShader).not.toContain("lineExpandedPosition(");
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

  it("expands authored line primitives in screen space", () => {
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

  it("reserves the widened edge footprint in sloped surface depth", () => {
    expect(instanceVertexShader).toContain("instanceHasEdgeOverlay(instance.selected)");
    expect(instanceVertexShader).toContain("camera.devicePixelRatio");
    expect(instanceVertexShader).toMatch(/output\.edgeDepthRadius\s*=/);
    expect(triangleColorFragmentShader).toMatch(/@builtin\(position\) fragmentPosition/);
    expect(triangleColorFragmentShader).toMatch(/@location\(12\).*edgeDepthRadius/);
    expect(triangleColorFragmentShader).toMatch(/dpdx\(fragmentPosition\.z\)/);
    expect(triangleColorFragmentShader).toMatch(/dpdy\(fragmentPosition\.z\)/);
    expect(triangleColorFragmentShader).toContain("depthSlope == depthSlope");
    expect(triangleColorFragmentShader).toMatch(/@builtin\(frag_depth\) depth/);
  });

  it("leaves coplanar line depth bias to the edge pipeline", () => {
    expect(edgeFragmentShader).not.toMatch(/@builtin\(frag_depth\)/);
    expect(edgeFragmentShader).not.toContain("16777215");
  });
});
