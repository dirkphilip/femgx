import { describe, expect, it } from "vitest";
import { createCamera, resizeCamera, type FacePickTarget, type NodePickTarget } from "../../src";
import { hitPointFromPick } from "../../src/picking/hit-point";

const camera = resizeCamera(
  createCamera({ position: [0, 0, 5], target: [0, 0, 0], fovY: Math.PI / 3 }),
  100,
  100,
);

describe("hitPointFromPick", () => {
  it("uses an exact node world position", () => {
    const hit: NodePickTarget = {
      kind: "node",
      partId: 1,
      instanceId: "node",
      elementId: 1,
      nodeId: 2,
      localPosition: [1, 2, 3],
      worldPosition: [4, 5, 6],
      neighborElementIds: [],
      neighborNodeIds: [],
    };
    expect(hitPointFromPick(camera, 50, 50, hit)).toEqual([4, 5, 6]);
  });

  it("intersects the camera ray with the closest picked face", () => {
    const hit: FacePickTarget = {
      kind: "face",
      partId: 1,
      instanceId: "face",
      elementId: 1,
      faceId: 1,
      faceIndex: 0,
      key: "0:1:2",
      nodeIds: [0, 1, 2],
      neighborElementIds: [],
      hitPosition: [0, 0, 0],
      normal: [0, 0, 1],
    };
    const pivot = hitPointFromPick(camera, 75, 50, hit);
    expect(pivot?.[0]).toBeCloseTo(5 * Math.tan(Math.PI / 6) * 0.5);
    expect(pivot?.[1]).toBeCloseTo(0);
    expect(pivot?.[2]).toBeCloseTo(0);
  });
});
