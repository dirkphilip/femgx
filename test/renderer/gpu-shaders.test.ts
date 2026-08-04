import { describe, expect, it } from "vitest";
import { WgslReflect, type StructInfo } from "wgsl_reflect";
import { EMISSIVE_BYTE_OFFSET, INSTANCE_STRIDE } from "../../src/renderer/gpu-draw";
import {
  ELEMENT_RECORD_STRIDE,
  HIGHLIGHT_HEADER,
  MAX_ELEMENT_HIGHLIGHTS,
} from "../../src/renderer/gpu-elements";
import { CAMERA_UNIFORM_SIZE } from "../../src/renderer/gpu-pipelines";
import {
  colorFragmentShader,
  edgeVertexShader,
  instanceVertexShader,
  pointVertexShader,
} from "../../src/renderer/gpu-shaders";

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

  it("keeps ElementHighlight records aligned with encodeElementHighlight", () => {
    const offsets = memberOffsets(structInfo(instanceVertexShader, "ElementHighlight"));
    expect(offsets.get("slot")).toBe(0);
    expect(offsets.get("elementPickId")).toBe(4);
    expect(offsets.get("color")).toBe(16);
    expect(offsets.get("emissive")).toBe(32);
    expect(structInfo(instanceVertexShader, "ElementHighlight").size).toBe(ELEMENT_RECORD_STRIDE);
  });

  it("places ElementHighlights records at the header offset and stride the CPU allocates", () => {
    const info = structInfo(instanceVertexShader, "ElementHighlights");
    const offsets = memberOffsets(info);
    expect(offsets.get("count")).toBe(0);
    expect(offsets.get("records")).toBe(HIGHLIGHT_HEADER);
    expect(info.size).toBe(HIGHLIGHT_HEADER + MAX_ELEMENT_HIGHLIGHTS * ELEMENT_RECORD_STRIDE);
  });

  it.each(vertexShaders)(
    "keeps the Camera uniform layout aligned with encodeFrame in %s",
    (_name, source) => {
      const info = structInfo(source, "Camera");
      const offsets = memberOffsets(info);
      expect(offsets.get("viewProjection")).toBe(0);
      expect(offsets.get("viewport")).toBe(64);
      expect(offsets.get("pointSize")).toBe(72);
      expect(info.size).toBe(CAMERA_UNIFORM_SIZE);
    },
  );

  it("passes the per-instance emissive to the fragment stage", () => {
    const output = structInfo(instanceVertexShader, "VertexOutput");
    expect(output.members.find((member) => member.name === "emissive")?.type.name).toBe("f32");
    expect(instanceVertexShader).toMatch(/@location\(2\) @interpolate\(flat\) emissive: f32/);
    expect(instanceVertexShader).toMatch(/output\.emissive = emissive;/);
  });

  it("overrides triangle colors from the element-highlight records", () => {
    expect(instanceVertexShader).toMatch(/triangleElementPickIds\[vertexIndex \/ 3u\]/);
    expect(instanceVertexShader).toMatch(/elementHighlights\.records\[index\]/);
    expect(instanceVertexShader).toMatch(/@location\(3\) @interpolate\(flat\) elementPickId: u32/);
  });

  it("applies emissive additively in the color fragment shader", () => {
    expect(colorFragmentShader).toMatch(/@location\(2\) @interpolate\(flat\) emissive: f32/);
    expect(colorFragmentShader).toMatch(/color\.rgb \+ vec3<f32>\(emissive\)/);
  });
});
