import { describe, expect, it } from "vitest";
import { canvasCssToRenderPixel, clientToCanvasCss } from "../../src/camera/coordinates";

describe("canvas coordinates", () => {
  it("converts client coordinates to the canvas CSS origin", () => {
    expect(clientToCanvasCss(125, 90, { left: 25, top: 40 })).toEqual({ x: 100, y: 50 });
  });

  it("maps scaled CSS coordinates through a non-integer pixel ratio", () => {
    expect(
      canvasCssToRenderPixel(
        { x: 100, y: 50 },
        { width: 400, height: 200 },
        { width: 500, height: 250 },
      ),
    ).toEqual({ x: 125, y: 62 });
  });

  it("clamps points to the render-target extent", () => {
    expect(
      canvasCssToRenderPixel(
        { x: 500, y: -10 },
        { width: 400, height: 200 },
        { width: 800, height: 400 },
      ),
    ).toEqual({ x: 799, y: 0 });
  });
});
