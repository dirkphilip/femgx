import { describe, expect, it } from "vitest";
import {
  conformanceRunnerMatrix,
  summarizeConformance,
  type ConformanceEvidence,
} from "../../scripts/webgpu-conformance.mjs";

function evidence(target: string, platform: string, vendor: string): ConformanceEvidence {
  return {
    schemaVersion: 1,
    kind: "hardware-webgpu-conformance",
    capturedAt: "2026-08-19T12:00:00.000Z",
    target,
    platform,
    browser: { name: "Google Chrome", version: "151" },
    adapter: {
      vendor,
      architecture: "native",
      device: "GPU",
      description: "hardware",
      isFallbackAdapter: false,
    },
    assertions: {
      perspective: true,
      scalarColors: true,
      selectedAndHighlighted: true,
      transparency: true,
      sectionCaps: true,
      picking: true,
      orientationGizmo: true,
    },
    captures: [{ name: "desktop" }, { name: "mobile-390x844" }],
  };
}

describe("hardware WebGPU conformance reporting", () => {
  it("routes only online, explicitly labelled hardware runners", () => {
    const matrix = conformanceRunnerMatrix(
      [
        { status: "online", labels: [{ name: "femgx-webgpu-apple" }] },
        { status: "offline", labels: [{ name: "femgx-webgpu-nvidia" }] },
      ],
      ["apple", "windows-nvidia"],
    );

    expect(matrix).toEqual([
      { target: "apple", name: "Apple", runner: "femgx-webgpu-apple", state: "available" },
      {
        target: "windows-nvidia",
        name: "Windows / NVIDIA",
        runner: "ubuntu-latest",
        state: "unavailable",
      },
    ]);
  });

  it("reports missing required hardware instead of treating it as a pass", () => {
    const summary = summarizeConformance(
      [evidence("apple", "darwin", "Apple")],
      ["apple", "windows-nvidia"],
    );

    expect(summary.missing).toEqual(["windows-nvidia"]);
    expect(summary.markdown).toContain("| Apple | conformant |");
    expect(summary.markdown).toContain("| Windows / NVIDIA | unavailable |");
  });

  it("compares valid Apple and Windows/NVIDIA evidence", () => {
    const summary = summarizeConformance(
      [evidence("apple", "darwin", "Apple"), evidence("windows-nvidia", "win32", "NVIDIA")],
      ["apple", "windows-nvidia"],
    );

    expect(summary.missing).toEqual([]);
    expect(summary.markdown.match(/conformant/gu)).toHaveLength(2);
  });

  it("rejects evidence produced by the wrong adapter class", () => {
    const summary = summarizeConformance(
      [evidence("windows-nvidia", "win32", "Intel")],
      ["windows-nvidia"],
    );

    expect(summary.missing).toEqual(["windows-nvidia"]);
    expect(summary.markdown).toContain("invalid: expected NVIDIA hardware on Windows");
  });
});
