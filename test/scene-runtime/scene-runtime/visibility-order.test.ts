import { describe, expect, it } from "vitest";
import { buildScene, createPackedSceneRuntime, identityMatrix, translationMatrix } from "./support";

describe("createPackedSceneRuntime visibility ordering", () => {
  it("preserves deterministic draw order across hide/show round trips", () => {
    const scene = buildScene(
      1,
      [
        {
          id: 1,
          placements: [
            {
              kind: "part",
              placementId: "0",
              partId: 2,
              transform: identityMatrix(),
            },
            {
              kind: "part",
              placementId: "1",
              partId: 1,
              transform: identityMatrix(),
            },
            {
              kind: "assembly",
              placementId: "2",
              assemblyId: 2,
              transform: identityMatrix(),
            },
          ],
        },
        {
          id: 2,
          placements: [
            {
              kind: "part",
              placementId: "0",
              partId: 3,
              transform: identityMatrix(),
            },
          ],
        },
      ],
      [1, 2, 3],
    );
    const runtime = createPackedSceneRuntime(scene);
    const initial = Array.from(runtime.getDrawList());
    runtime.setPartVisible(1, false);
    runtime.setAssemblyVisible(2, false);
    runtime.setPartVisible(1, true);
    runtime.setAssemblyVisible(2, true);
    expect(Array.from(runtime.getDrawList())).toEqual(initial);
  });

  it("keeps depth-first slot and draw ordering deterministic", () => {
    const scene = buildScene(
      1,
      [
        {
          id: 1,
          placements: [
            {
              kind: "part",
              placementId: "0",
              partId: 2,
              transform: translationMatrix(1, 0, 0),
            },
            {
              kind: "assembly",
              placementId: "1",
              assemblyId: 2,
              transform: translationMatrix(0, 0, 0),
            },
            {
              kind: "part",
              placementId: "2",
              partId: 1,
              transform: translationMatrix(2, 0, 0),
            },
          ],
        },
        {
          id: 2,
          placements: [
            {
              kind: "part",
              placementId: "0",
              partId: 3,
              transform: translationMatrix(0, 0, 0),
            },
          ],
        },
      ],
      [1, 2, 3],
    );
    const runtime = createPackedSceneRuntime(scene);
    expect(Array.from(runtime.getDrawList())).toEqual([0, 1, 2]);
    expect(Array.from(runtime.instancePartIds)).toEqual([2, 3, 1]);
    expect(runtime.getInstanceId(0)).toBe("1/0");
    expect(runtime.getInstanceId(1)).toBe("1/1/0");
    expect(runtime.getInstanceId(2)).toBe("1/2");
  });
});
