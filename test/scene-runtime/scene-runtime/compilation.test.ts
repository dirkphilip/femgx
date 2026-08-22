import { describe, expect, it } from "vitest";
import {
  buildScene,
  identityMatrix,
  translationMatrix,
  MAX_PART_ID,
  createPackedSceneRuntime,
} from "./support";

describe("createPackedSceneRuntime", () => {
  it("preserves the largest supported part id in packed runtime and grouping", () => {
    const scene = buildScene(
      1,
      [
        {
          id: 1,
          placements: [
            {
              kind: "part",
              placementId: "0",
              partId: MAX_PART_ID,
              transform: identityMatrix(),
            },
          ],
        },
      ],
      [MAX_PART_ID],
    );
    const runtime = createPackedSceneRuntime(scene);
    expect(runtime.instancePartIds[0]).toBe(MAX_PART_ID);
    expect(runtime.getPartIds()[0]).toBe(MAX_PART_ID);
    expect(runtime.getPartId(0)).toBe(MAX_PART_ID);
  });

  it("compiles parts, nested assemblies, and composed transforms", () => {
    const scene = buildScene(
      1,
      [
        {
          id: 1,
          placements: [
            {
              kind: "part",
              placementId: "0",
              partId: 1,
              transform: translationMatrix(10, 0, 0),
            },
            {
              kind: "assembly",
              placementId: "1",
              assemblyId: 2,
              transform: translationMatrix(100, 0, 0),
            },
          ],
        },
        {
          id: 2,
          placements: [
            {
              kind: "part",
              placementId: "0",
              partId: 2,
              transform: translationMatrix(1, 0, 0),
            },
          ],
        },
      ],
      [1, 2],
    );
    const runtime = createPackedSceneRuntime(scene);
    expect(runtime.instanceCount).toBe(2);
    expect(runtime.nodeCount).toBe(2);
    expect(runtime).not.toHaveProperty("instanceLocalTransforms");
    expect(runtime).not.toHaveProperty("nodeLocalTransforms");
    expect(runtime.nodeWorldTransforms[12]).toBe(0);
    expect(runtime.nodeWorldTransforms[28]).toBe(100);
    expect(Array.from(runtime.instancePartIds)).toEqual([1, 2]);
    expect(runtime.getTransform(0)?.[12]).toBe(10);
    expect(runtime.getTransform(1)?.[12]).toBe(101);
    expect(runtime.visibleCount).toBe(2);
    expect(Array.from(runtime.getDrawList())).toEqual([0, 1]);
  });

  it("assigns stable slots to hidden placements too", () => {
    const scene = buildScene(
      1,
      [
        {
          id: 1,
          placements: [
            {
              kind: "part",
              placementId: "0",
              partId: 1,
              transform: identityMatrix(),
            },
            {
              kind: "part",
              placementId: "1",
              partId: 2,
              transform: identityMatrix(),
            },
          ],
        },
      ],
      [1, 2],
      [2],
    );
    const runtime = createPackedSceneRuntime(scene);
    expect(runtime.instanceCount).toBe(2);
    expect(runtime.visibleCount).toBe(1);
    expect(runtime.isInstanceVisible(0)).toBe(true);
    expect(runtime.isInstanceVisible(1)).toBe(false);
    expect(Array.from(runtime.getDrawList())).toEqual([0]);
    expect(runtime.getPartId(1)).toBe(2);
  });
});
