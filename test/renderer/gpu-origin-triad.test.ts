import { describe, expect, it } from "vitest";
import { createPart } from "../../src/geometry/part";
import { translation } from "../../src/math/mat4";
import { createPackedSceneRuntime } from "../../src/scene-runtime/runtime";
import { createScene } from "../../src/scene/scene";
import { originTriadDimensions, originTriadScale } from "../../src/renderer/gpu-origin-triad";

describe("world-origin triad", () => {
  it("derives finite dimensions from one scene scale", () => {
    expect(originTriadDimensions(10)).toEqual({
      scale: 10,
      shaftRadius: 0.25,
      arrowLength: 2.2,
      arrowWidth: 1.2,
      hubRadius: 0.6,
    });
    expect(originTriadDimensions(Number.NaN).scale).toBeGreaterThan(0);
  });

  it("uses complete placed bounds even when an occurrence is hidden", () => {
    const part = createPart(1, {
      positions: new Float32Array([0, 0, 0, 2, 0, 0, 0, 1, 0]),
      indices: new Uint32Array([0, 1, 2]),
      primitive: "triangles",
    });
    const scene = createScene()
      .addPart(part)
      .addAssembly({
        id: 1,
        name: "root",
        placements: [
          { kind: "part", partId: 1, transform: translation(0, 0, 0) },
          { kind: "part", partId: 1, transform: translation(10, 0, 0) },
        ],
      })
      .withRoot(1)
      .build();
    const runtime = createPackedSceneRuntime(scene);
    const completeScale = originTriadScale(runtime, scene.parts);
    runtime.setInstanceVisible(1, false);

    expect(originTriadScale(runtime, scene.parts)).toBe(completeScale);
    expect(completeScale).toBeCloseTo(Math.hypot(12, 1) * 0.12);
  });
});
