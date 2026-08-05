import { describe, expect, it } from "vitest";
import { unsupportedMessage, WebGpuUnsupportedError } from "../../src/index";
import { classifyWebGpuStartupError, phaseForReason } from "../../demo/webgpu-startup";

describe("phaseForReason", () => {
  it("maps each typed unsupported reason to its startup phase", () => {
    expect(phaseForReason("no-webgpu")).toBe("api");
    expect(phaseForReason("adapter-unavailable")).toBe("adapter");
    expect(phaseForReason("device-unavailable")).toBe("device");
  });
});

describe("classifyWebGpuStartupError", () => {
  it("classifies a missing WebGPU API", () => {
    const diagnostic = classifyWebGpuStartupError(
      "renderer-setup",
      new WebGpuUnsupportedError("no-webgpu", unsupportedMessage("no-webgpu")),
    );
    expect(diagnostic.phase).toBe("api");
    expect(diagnostic.message).toContain("navigator.gpu");
  });

  it("classifies an unavailable adapter", () => {
    const diagnostic = classifyWebGpuStartupError(
      "renderer-setup",
      new WebGpuUnsupportedError("adapter-unavailable", unsupportedMessage("adapter-unavailable")),
    );
    expect(diagnostic.phase).toBe("adapter");
    expect(diagnostic.message).toContain("adapter");
  });

  it("classifies a device-creation failure", () => {
    const diagnostic = classifyWebGpuStartupError(
      "renderer-setup",
      new WebGpuUnsupportedError("device-unavailable", unsupportedMessage("device-unavailable")),
    );
    expect(diagnostic.phase).toBe("device");
    expect(diagnostic.message).toContain("device");
  });

  it("keeps the fallback phase for a generic renderer-setup error", () => {
    const diagnostic = classifyWebGpuStartupError("renderer-setup", new Error("pipeline exploded"));
    expect(diagnostic.phase).toBe("renderer-setup");
    expect(diagnostic.message).toBe("WebGPU is unavailable: pipeline exploded");
  });

  it("keeps the frame-submission phase for a generic frame error", () => {
    const diagnostic = classifyWebGpuStartupError("frame-submission", new Error("submit failed"));
    expect(diagnostic.phase).toBe("frame-submission");
    expect(diagnostic.message).toBe("WebGPU is unavailable: submit failed");
  });

  it("formats a non-Error thrown value", () => {
    const diagnostic = classifyWebGpuStartupError("renderer-setup", "boom");
    expect(diagnostic.phase).toBe("renderer-setup");
    expect(diagnostic.message).toBe("WebGPU is unavailable: boom");
  });
});
