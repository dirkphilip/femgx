import { describe, expect, it } from "vitest";
import { depthTestUiState } from "../../demo/controller";

describe("depthTestUiState", () => {
  it("keeps the working on/off toggle on a renderer that supports depth-tested edges", () => {
    expect(depthTestUiState(true, true)).toEqual({
      disabled: false,
      label: "On",
      buttonText: "Depth test off",
    });
    expect(depthTestUiState(true, false)).toEqual({
      disabled: false,
      label: "Off",
      buttonText: "Depth test on",
    });
  });

  it("disables and annotates the control on a renderer without depth-tested edges", () => {
    for (const enabled of [true, false]) {
      expect(depthTestUiState(false, enabled)).toEqual({
        disabled: true,
        label: "WebGPU only",
        buttonText: "Depth test · WebGPU only",
      });
    }
  });
});
