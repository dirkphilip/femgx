import { describe, expect, it } from "vitest";
import { validatePickIds, type Geometry } from "./support";

describe("validatePickIds", () => {
  it("accepts aligned node and face pick ids", () => {
    const geometry: Geometry = {
      positions: new Float32Array(9),
      indices: new Uint32Array(9),
      primitive: "triangles" as const,
      nodePickIds: new Uint32Array([1, 2, 3]),
      faces: [
        {
          elementId: 0,
          faceIndex: 0,
          primitiveStart: 0,
          primitiveCount: 3,
          key: "0,1,2",
          nodeIds: [0, 1, 2],
        },
      ],
    };
    expect(() => {
      validatePickIds(geometry, undefined, undefined);
    }).not.toThrow();
  });

  it("rejects node pick ids that do not match the vertex count", () => {
    expect(() => {
      validatePickIds(
        {
          positions: new Float32Array(9),
          indices: new Uint32Array(9),
          primitive: "triangles" as const,
          nodePickIds: new Uint32Array([1, 2]),
        },
        undefined,
        undefined,
      );
    }).toThrow("nodePickIds must have one entry per vertex");
  });

  it("rejects face ranges that do not match the triangle count", () => {
    expect(() => {
      validatePickIds(
        {
          positions: new Float32Array(9),
          indices: new Uint32Array(9),
          primitive: "triangles" as const,
          faces: [
            {
              elementId: 0,
              faceIndex: 0,
              primitiveStart: 0,
              primitiveCount: 4,
              key: "0,1,2",
              nodeIds: [0, 1, 2],
            },
          ],
        },
        undefined,
        undefined,
      );
    }).toThrow("outside the triangle buffer");
  });
});
