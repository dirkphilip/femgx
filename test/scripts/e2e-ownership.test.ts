import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "../..");

describe("browser suite ownership", () => {
  it("keeps workbench and WebGPU contracts in bounded feature suites", () => {
    const suites = [
      "demo-lifecycle.spec.ts",
      "demo-results.spec.ts",
      "demo-visibility.spec.ts",
      "demo-interaction.spec.ts",
      "webgpu-lifecycle.spec.ts",
      "webgpu-rendering.spec.ts",
      "webgpu-camera.spec.ts",
      "webgpu-visibility.spec.ts",
    ];
    for (const suite of suites) expect(existsSync(join(root, "e2e", suite))).toBe(true);
    expect(existsSync(join(root, "e2e", "demo.spec.ts"))).toBe(false);
    expect(existsSync(join(root, "e2e", "webgpu.spec.ts"))).toBe(false);
  });

  it("keeps CPU-only menu ownership out of WebGPU rendering suites", () => {
    const webGpuSources = [
      "webgpu-lifecycle.spec.ts",
      "webgpu-rendering.spec.ts",
      "webgpu-camera.spec.ts",
      "webgpu-visibility.spec.ts",
    ].map((suite) => readFileSync(join(root, "e2e", suite), "utf8"));
    expect(webGpuSources.join("\n")).not.toContain("does not advertise CPU-only");
  });

  it("keeps the CI unsupported-contract command on the lifecycle owner", () => {
    const packageJson = readFileSync(join(root, "package.json"), "utf8");
    expect(packageJson).toContain("e2e/webgpu-lifecycle.spec.ts");
    expect(packageJson).not.toContain("e2e/webgpu.spec.ts");
  });
});
