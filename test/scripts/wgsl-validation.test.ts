import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

import { createGpuBundle } from "../../src/renderer/recovery";
import { edgePickFragmentShader, edgePickVertexShader } from "../../src/renderer/edges/edge-pick";
import { fakeGpuDevice, installGpuGlobals } from "../renderer/fake-gpu";

describe("offline WGSL validation", () => {
  it("validates every shader captured by the initial renderer bundle with Naga", async () => {
    const restore = installGpuGlobals();
    const temporaryDirectory = await mkdtemp(join(process.cwd(), ".femgx-wgsl-"));
    try {
      const gpu = fakeGpuDevice();
      await createGpuBundle(gpu.device, "bgra8unorm", "depth24plus");
      const files = await writeShaderFiles(temporaryDirectory, [
        ...gpu.shaderModuleDescriptors,
        { label: "authored edge pick vertex", code: edgePickVertexShader },
        { label: "authored edge pick fragment", code: edgePickFragmentShader },
      ]);
      execFileSync(
        "naga-wasi-cli",
        ["--bulk-validate", ...files.map((file) => relative(process.cwd(), file))],
        { stdio: "pipe", env: { ...process.env, NODE_NO_WARNINGS: "1" } },
      );
      expect(files).toHaveLength(31);
    } finally {
      restore();
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });
});

async function writeShaderFiles(
  directory: string,
  descriptors: readonly GPUShaderModuleDescriptor[],
): Promise<readonly string[]> {
  const files: string[] = [];
  for (const [index, descriptor] of descriptors.entries()) {
    const file = join(directory, `${index}-${sanitize(descriptor.label ?? "shader")}.wgsl`);
    await writeFile(file, descriptor.code, "utf8");
    files.push(file);
  }
  return files;
}

function sanitize(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
