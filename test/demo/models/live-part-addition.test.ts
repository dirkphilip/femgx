import { describe, expect, it } from "vitest";
import {
  createPart,
  createSceneBuilder,
  identityMatrix,
  type Scene,
} from "@/entries/root";
import {
  MAX_LIVE_PART_COPIES,
  parseLivePartRequest,
  prepareLivePartEdit,
} from "../../../demo/workbench/live-part-addition";
import type { WorkbenchModel } from "../../../demo/workbench/models/model";

describe("live workbench part addition", () => {
  it("prebuilds one reusable mesh and deterministic collision-free placements", () => {
    const edit = prepareLivePartEdit(model(scene()), {
      kind: "add",
      copies: 3,
      spacing: 2,
    });

    expect(edit.partId).toBe(2);
    expect(edit.placements.map((placement) => placement.placementId)).toEqual([
      "live-2-1",
      "live-2-2",
      "live-2-3",
    ]);
    expect(edit.placements.map((placement) => Array.from(placement.transform))).toEqual([
      Array.from(identityMatrix()).map((value, index) => (index === 12 ? 3 : value)),
      Array.from(identityMatrix()).map((value, index) => (index === 12 ? 6 : value)),
      Array.from(identityMatrix()).map((value, index) =>
        index === 12 || index === 14 ? 3 : value,
      ),
    ]);
  });

  it("bounds dialog inputs before allocating placements", () => {
    expect(parseLivePartRequest("add", undefined, "0", "1")).toBeUndefined();
    expect(
      parseLivePartRequest("add", undefined, String(MAX_LIVE_PART_COPIES + 1), "1"),
    ).toBeUndefined();
    expect(parseLivePartRequest("instance", undefined, "1", "1")).toBeUndefined();
    expect(parseLivePartRequest("instance", 1, "2", "0.5")).toEqual({
      kind: "instance",
      partId: 1,
      copies: 2,
      spacing: 0.5,
    });
  });
});

function scene(): Scene {
  const part = createPart(1, {
    geometries: [
      {
        primitive: "points",
        positions: new Float32Array([0, 0, 0]),
        indices: new Uint32Array([0]),
      },
    ],
  });
  return createSceneBuilder()
    .addPart(part)
    .addAssembly({
      id: 1,
      placements: [{ kind: "part", partId: 1, placementId: "source", transform: identityMatrix() }],
    })
    .setRootAssembly(1)
    .build();
}

function model(scene: Scene): WorkbenchModel {
  return {
    id: "live-edit-test",
    name: "Live edit test",
    source: "example",
    scene,
    elementModels: new Map(),
    partNames: new Map([[1, "Source"]]),
    partStyles: new Map(),
    bounds: { minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 1, maxZ: 1 },
    results: undefined,
    issues: [],
  };
}
