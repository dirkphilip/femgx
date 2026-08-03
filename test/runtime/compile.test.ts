import { describe, expect, it } from "vitest";
import { computeBounds, type Part } from "../../src/geometry/part";
import { compileScene } from "../../src/runtime/compile";
import { createScene } from "../../src/scene/scene";
import { translation } from "../../src/math/mat4";
import { createCamera, viewProjectionMatrix } from "../../src/camera/camera";

function part(id: number): Part {
  const geometry = { positions: new Float32Array([0, 0, 0]), indices: new Uint32Array() };
  return { id, geometry, bounds: computeBounds(geometry) };
}

describe("compileScene", () => {
  it("creates visible instances and per-part batches", () => {
    const scene = createScene()
      .addPart(part(1))
      .addAssembly({
        id: 1,
        name: "root",
        placements: [
          { kind: "part", partId: 1, transform: translation(0, 0, 0) },
          { kind: "part", partId: 1, transform: translation(1, 0, 0) },
        ],
      })
      .withRoot(1)
      .build();
    const compiled = compileScene(scene);
    expect(compiled.instances).toHaveLength(2);
    expect(compiled.batches).toHaveLength(1);
    expect(compiled.batches[0]?.instances).toHaveLength(2);
  });

  it("culls instances outside the camera frustum while preserving handles", () => {
    const geometry = {
      positions: new Float32Array([0, 0, 0]),
      indices: new Uint32Array(),
    };
    const scene = createScene()
      .addPart({ id: 1, geometry, bounds: computeBounds(geometry) })
      .addAssembly({
        id: 1,
        name: "root",
        placements: [
          { kind: "part", partId: 1, transform: translation(0, 0, 0) },
          { kind: "part", partId: 1, transform: translation(10_000, 0, 0) },
        ],
      })
      .withRoot(1)
      .build();
    const compiled = compileScene(scene, { viewProjection: viewProjectionMatrix(createCamera()) });
    expect(compiled.instances).toHaveLength(1);
    expect(compiled.instances[0]?.instanceId).toBe("1/0");
  });
});
