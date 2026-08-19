import { expect, it, describe } from "vitest";
import {
  instanceVertexShader,
  selectionVertexShader,
  selectionFragmentShader,
  selectionTransparencyFragmentShader,
} from "./support";

describe("selection emphasis shaders", () => {
  it("bypasses neighbor suppression only for exact element and face selection", () => {
    expect(instanceVertexShader).toContain("primitiveVisible(drawOrder[instanceIndex]");
    expect(instanceVertexShader).not.toContain("if (!primitiveSelectionVisible");
    expect(selectionVertexShader).toContain("primitiveSelectionVisible(drawOrder[instanceIndex]");
    expect(selectionVertexShader).toContain(
      "exactSelection = exactSelection || highlight.selected",
    );
  });

  it("keeps the visible selection cue uniform across triangle faces", () => {
    expect(selectionFragmentShader).toContain("color.a <= 0.0");
    expect(selectionFragmentShader).toContain("visibleSelectionAlpha(color.a)");
    expect(selectionFragmentShader).not.toContain("surfaceLighting(");
  });

  it("keeps result colors available in visible and hidden selection passes", () => {
    expect(instanceVertexShader).toContain("@group(1) @binding(8)");
    expect(instanceVertexShader).toContain(
      "select(nodePickId, elementOrdinal, resultColors[table] == 1.0)",
    );
    for (const source of [selectionFragmentShader, selectionTransparencyFragmentShader]) {
      expect(source).toContain("@location(10) resultColor: vec4<f32>");
      expect(source).toContain("resultColorEnabled: u32");
      expect(source).toContain("selectionColor(");
    }
  });
});
