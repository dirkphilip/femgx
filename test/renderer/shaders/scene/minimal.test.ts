import { expect, it, describe } from "vitest";
import {
  minimalTriangleColorFragmentShader,
  minimalTriangleTransparencyFragmentShader,
  minimalTriangleVertexShader,
} from "./support";

describe("minimal geometry shader contract", () => {
  it("does not declare or read optional feature bindings", () => {
    const sources = [
      minimalTriangleVertexShader,
      minimalTriangleColorFragmentShader,
      minimalTriangleTransparencyFragmentShader,
    ];
    expect(minimalTriangleVertexShader).toContain("@group(0) @binding(0) var<uniform> camera");
    expect(minimalTriangleVertexShader).toContain(
      "@group(1) @binding(0) var<storage, read> instances",
    );
    expect(minimalTriangleVertexShader).toContain(
      "@group(1) @binding(1) var<storage, read> drawOrder",
    );
    for (const source of sources) {
      expect(source).not.toMatch(/@group\(1\) @binding\([2-7]\)/);
      expect(source).not.toContain("elementHighlights");
      expect(source).not.toContain("displacements");
      expect(source).not.toContain("geometryPositions");
      expect(source).not.toContain("sectionPlaneVisible");
      expect(source).not.toContain("topologyData");
    }
  });
});
