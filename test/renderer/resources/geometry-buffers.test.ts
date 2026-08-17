import { describe, expect, it } from "vitest";
import { packTopologyData } from "../../../src/renderer/resources/geometry-buffers";

describe("packed topology data", () => {
  it("stores element ordinals before primitive and edge metadata", () => {
    const data = packTopologyData(
      new Uint32Array([10, 11, 12, 13, 14]),
      new Uint32Array([0, 1]),
      new Uint32Array([20, 21]),
      new Uint32Array([30, 31]),
      {
        elementOrdinals: new Uint32Array([41, 42]),
        primitiveIds: new Uint32Array([51, 52]),
        edgeIds: new Uint32Array([61, 62]),
      },
    );

    expect(Array.from(data)).toEqual([
      1, 1, 1, 2, 10, 11, 12, 13, 14, 0, 1, 20, 21, 30, 31, 41, 42, 2, 51, 52, 61, 62,
    ]);
  });
});
