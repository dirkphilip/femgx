import { describe, expect, it } from "vitest";
import {
  transparencyFragmentShader,
  transparencyOutput,
  triangleTransparencyFragmentShader,
  TRANSPARENCY_REVEALAGE_FORMAT,
} from "../../src/renderer/core/gpu-transparency";

const MIN_WEIGHT = 0.01;
const MAX_WEIGHT = 8;

function mirroredSceneWeight(alpha: number, depth: number): number {
  const safeAlpha = Number.isNaN(alpha) ? 0 : Math.min(Math.max(alpha, 0), 1);
  const safeDepth = Number.isNaN(depth) ? 0 : Math.min(Math.max(depth, 0), 1);
  const alphaWeight = Math.max(MIN_WEIGHT, safeAlpha * 8);
  return Math.min(Math.max(alphaWeight * (1 - safeDepth * 0.75), MIN_WEIGHT), MAX_WEIGHT);
}

describe("depth-aware transparency weight", () => {
  it("uses a scalar revealage attachment", () => {
    expect(TRANSPARENCY_REVEALAGE_FORMAT).toBe("r8unorm");
    expect(transparencyOutput).toContain("@location(1) revealage: f32");
  });

  it("stays finite and bounded for invalid and boundary inputs", () => {
    for (const alpha of [Number.NaN, Number.NEGATIVE_INFINITY, 0, 0.5, 1, Infinity]) {
      for (const depth of [Number.NaN, Number.NEGATIVE_INFINITY, 0, 0.5, 1, Infinity]) {
        const weight = mirroredSceneWeight(alpha, depth);
        expect(Number.isFinite(weight)).toBe(true);
        expect(weight).toBeGreaterThanOrEqual(MIN_WEIGHT);
        expect(weight).toBeLessThanOrEqual(MAX_WEIGHT);
      }
    }
  });

  it("favors nearer fragments and never reduces weight as alpha rises", () => {
    for (const alpha of [0.05, 0.25, 0.5, 0.9]) {
      expect(mirroredSceneWeight(alpha, 0)).toBeGreaterThanOrEqual(mirroredSceneWeight(alpha, 1));
    }
    for (const depth of [0, 0.25, 0.75, 1]) {
      let previous = mirroredSceneWeight(0, depth);
      for (const alpha of [0.1, 0.25, 0.5, 1]) {
        const next = mirroredSceneWeight(alpha, depth);
        expect(next).toBeGreaterThanOrEqual(previous);
        previous = next;
      }
    }
  });

  it("keeps a supported high-overlap accumulation finite", () => {
    const accumulatedWeight = Array.from({ length: 4096 }, () => mirroredSceneWeight(1, 0)).reduce(
      (sum, weight) => sum + weight,
      0,
    );
    expect(Number.isFinite(accumulatedWeight)).toBe(true);
    expect(accumulatedWeight).toBeLessThanOrEqual(65504);
  });

  it("uses fragment depth only for scene transparency", () => {
    expect(transparencyOutput).toContain("fn sceneTransparencyWeight(alpha: f32, depth: f32)");
    expect(transparencyOutput).toContain("fn weightedPresentationTransparency");
    expect(transparencyFragmentShader).toContain("@builtin(position) fragmentPosition: vec4<f32>");
    expect(triangleTransparencyFragmentShader).toContain(
      "@builtin(position) fragmentPosition: vec4<f32>",
    );
    expect(transparencyFragmentShader).toContain("fragmentPosition.z");
    expect(triangleTransparencyFragmentShader).toContain("fragmentPosition.z");
    expect(transparencyOutput).toContain("output.revealage = alpha");
  });
});
