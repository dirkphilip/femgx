import { describe, expect, it } from "vitest";
import {
  createValidatedComputePipeline,
  createValidatedRenderPipeline,
  createValidatedShaderModule,
  GpuValidationError,
} from "../../src/renderer/gpu-validation";
import { createGpuBundle } from "../../src/renderer/gpu-recovery";
import { cameraStruct } from "../../src/renderer/gpu-shaders";
import { fakeGpuDevice, installGpuGlobals } from "./fake-gpu";

describe("GPU validation", () => {
  it("reports warnings and includes source locations in shader failures", async () => {
    const warning = {
      type: "warning",
      message: "unused value",
      lineNum: 4,
      linePos: 5,
      offset: 12,
      length: 3,
    } as unknown as GPUCompilationMessage;
    const gpu = fakeGpuDevice({ shaderMessages: [warning] });
    const diagnostics: string[] = [];

    let failure: unknown;
    try {
      await createValidatedShaderModule(gpu.device, "triangle color vertex", "code", {
        onDiagnostic: (diagnostic) => diagnostics.push(diagnostic.message),
        shaderFailureLabel: "triangle color vertex",
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(GpuValidationError);
    expect(failure).toHaveProperty("message", expect.stringContaining("line 1, column 2"));
    expect(failure).toHaveProperty("message", expect.stringContaining("offset 3"));

    expect(diagnostics).toEqual(["unused value"]);
  });

  it("labels render and compute pipeline validation failures", async () => {
    const renderGpu = fakeGpuDevice({ renderPipelineError: "invalid render state" });
    await expect(
      createValidatedRenderPipeline(
        renderGpu.device,
        "triangle color",
        {} as GPURenderPipelineDescriptor,
      ),
    ).rejects.toThrow("[triangle color] invalid render state");

    const computeGpu = fakeGpuDevice({ computePipelineError: "invalid compute state" });
    await expect(
      createValidatedComputePipeline(
        computeGpu.device,
        "pick-depth compute/readback",
        {} as GPUComputePipelineDescriptor,
      ),
    ).rejects.toThrow("[pick-depth compute/readback] invalid compute state");
  });

  it("validates every shader module in the initial bundle", async () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      await createGpuBundle(gpu.device, "bgra8unorm", "depth24plus");
      expect(gpu.shaderModuleDescriptors.map((descriptor) => descriptor.label)).toEqual([
        "triangle color vertex",
        "line color vertex",
        "line selection vertex",
        "point color vertex",
        "triangle selection vertex",
        "line node picking vertex",
        "point node picking vertex",
        "line and point color fragment",
        "triangle color fragment",
        "line and point transparency fragment",
        "triangle transparency fragment",
        "triangle node picking vertex",
        "node picking fragment",
        "selection fragment",
        "triangle selection fragment",
        "selection transparency fragment",
        "triangle selection transparency fragment",
        "edge overlay vertex",
        "edge overlay fragment",
        "orientation glyph vertex",
        "orientation glyph visible fragment",
        "orientation glyph hidden fragment",
        "transparency composite",
        "node annotation fragment",
        "orbit pivot overlay",
        "world-origin triad",
        "viewport background",
        "pick-depth compute/readback",
      ]);
      const orbitShader = gpu.shaderModuleDescriptors.find(
        (descriptor) => descriptor.label === "orbit pivot overlay",
      );
      expect(orbitShader?.code).toContain(cameraStruct);
      expect(orbitShader?.code.match(/struct Camera \{/g)).toHaveLength(1);
      expect(orbitShader?.code).toContain("clip.z");
      expect(orbitShader?.code).not.toContain("clip.xy + offset * clip.w, 0.");
    } finally {
      restore();
    }
  });

  it("does not allocate frame buffers when validation fails", async () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      await expect(
        createGpuBundle(gpu.device, "bgra8unorm", "depth24plus", {
          shaderFailureLabel: "orbit pivot overlay",
        }),
      ).rejects.toBeInstanceOf(GpuValidationError);
      expect(gpu.buffers).toHaveLength(0);
    } finally {
      restore();
    }
  });
});
