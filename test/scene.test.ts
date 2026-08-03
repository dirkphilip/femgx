import { describe, expect, it } from "vitest";
import { createScene } from "../src/scene";
import { computeBounds, type Part } from "../src/part";

function part(id: number): Part {
  const geometry = { positions: new Float32Array([0, 0, 0]), indices: new Uint32Array() };
  return { id, geometry, bounds: computeBounds(geometry) };
}

describe("createScene", () => {
  it("builds a scene with parts, assemblies, and visibility state", () => {
    const scene = createScene()
      .addPart(part(1))
      .addAssembly({
        id: 1,
        name: "root",
        placements: [{ kind: "part", partId: 1, transform: new Float32Array(16) }],
      })
      .withRoot(1)
      .build();
    expect(scene.parts.size).toBe(1);
    expect(scene.assemblies.size).toBe(1);
    expect(scene.rootAssemblyId).toBe(1);
    expect(scene.visiblePartIds.has(1)).toBe(true);
    expect(scene.visibleAssemblyIds.has(1)).toBe(true);
  });

  it("hides and shows parts and assemblies immutably", () => {
    const scene = createScene()
      .addPart(part(1))
      .addAssembly({ id: 1, name: "root", placements: [] })
      .withRoot(1)
      .build();
    const hidden = createScene()
      .addPart(part(1))
      .addAssembly({ id: 1, name: "root", placements: [] })
      .withRoot(1)
      .hidePart(1)
      .hideAssembly(1)
      .build();
    expect(scene.visiblePartIds.has(1)).toBe(true);
    expect(hidden.visiblePartIds.has(1)).toBe(false);
    expect(hidden.visibleAssemblyIds.has(1)).toBe(false);
  });

  it("throws when building without a root", () => {
    expect(() => createScene().build()).toThrow("root assembly is not set");
  });
});
