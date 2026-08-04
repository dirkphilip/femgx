import { describe, expect, it } from "vitest";
import { EMISSIVE_BYTE_OFFSET } from "../../src/renderer/gpu-draw";
import { colorFragmentShader, instanceVertexShader } from "../../src/renderer/gpu-shaders";

/** Alignment and size of the WGSL scalar/vector types used by the record. */
const wgslTypeLayout: Readonly<
  Record<string, { readonly alignment: number; readonly size: number }>
> = {
  "mat4x4<f32>": { alignment: 16, size: 64 },
  "vec4<f32>": { alignment: 16, size: 16 },
  u32: { alignment: 4, size: 4 },
  f32: { alignment: 4, size: 4 },
  "vec2<u32>": { alignment: 8, size: 8 },
};

/** Parses a WGSL struct's fields, preserving declaration order. */
function structFields(
  source: string,
  name: string,
): ReadonlyArray<{ readonly name: string; readonly type: string }> {
  const pattern = new RegExp(`struct ${name} \\{([\\s\\S]*?)\\};`);
  const match = pattern.exec(source);
  if (match === null) throw new Error(`struct ${name} not found in shader`);
  const fields: Array<{ name: string; type: string }> = [];
  for (const rawLine of (match[1] ?? "").split("\n")) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("//")) continue;
    const parsed = /([A-Za-z_]\w*):\s*([A-Za-z0-9_<>]+),?$/.exec(line);
    if (parsed !== null) fields.push({ name: parsed[1] ?? "", type: parsed[2] ?? "" });
  }
  return fields;
}

/** Computes member byte offsets and the total stride under WGSL layout rules. */
function structLayout(
  source: string,
  name: string,
): ReadonlyMap<string, number> & { readonly stride: number } {
  const offsets = new Map<string, number>();
  let offset = 0;
  let maxAlignment = 1;
  for (const field of structFields(source, name)) {
    const layout = wgslTypeLayout[field.type];
    if (layout === undefined) throw new Error(`unknown WGSL type ${field.type}`);
    offset = Math.ceil(offset / layout.alignment) * layout.alignment;
    offsets.set(field.name, offset);
    offset += layout.size;
    maxAlignment = Math.max(maxAlignment, layout.alignment);
  }
  const withStride = offsets as typeof offsets & { stride: number };
  withStride.stride = Math.ceil(offset / maxAlignment) * maxAlignment;
  return withStride;
}

describe("GPU instance-record shader contract", () => {
  it("declares emissive in the Instance struct at the byte offset the encoder writes", () => {
    const layout = structLayout(instanceVertexShader, "Instance");
    expect(layout.get("transform")).toBe(0);
    expect(layout.get("color")).toBe(64);
    expect(layout.get("pickId")).toBe(80);
    expect(layout.get("emissive")).toBe(EMISSIVE_BYTE_OFFSET);
    expect(layout.stride).toBe(96);
  });

  it("passes the per-instance emissive to the fragment stage", () => {
    const output = structFields(instanceVertexShader, "VertexOutput");
    expect(output.find((field) => field.name === "emissive")?.type).toBe("f32");
    expect(instanceVertexShader).toMatch(/@location\(2\) @interpolate\(flat\) emissive: f32/);
    expect(instanceVertexShader).toMatch(/output\.emissive = instance\.emissive;/);
  });

  it("applies emissive additively in the color fragment shader", () => {
    expect(colorFragmentShader).toMatch(/@location\(2\) @interpolate\(flat\) emissive: f32/);
    expect(colorFragmentShader).toMatch(/color\.rgb \+ vec3<f32>\(emissive\)/);
  });
});
