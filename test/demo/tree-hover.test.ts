import { describe, expect, it } from "vitest";
import { createPart, createScene, createSceneRuntime, translation } from "../../src/index";
import { interactionTargetsForRow } from "../../demo/workbench/tree-hover";

function runtime() {
  const geometry = {
    positions: new Float32Array([0, 0, 0]),
    indices: new Uint32Array([0]),
    primitive: "points" as const,
  };
  const scene = createScene()
    .addPart(createPart(1, geometry))
    .addAssembly({
      id: 3,
      name: "empty",
      placements: [],
    })
    .addAssembly({
      id: 2,
      name: "reusable",
      placements: [
        { kind: "part", partId: 1, transform: translation(0, 0, 0) },
        { kind: "assembly", assemblyId: 3, transform: translation(1, 0, 0) },
      ],
    })
    .addAssembly({
      id: 1,
      name: "root",
      placements: [
        { kind: "assembly", assemblyId: 2, transform: translation(0, 0, 0) },
        { kind: "assembly", assemblyId: 2, transform: translation(2, 0, 0) },
      ],
    })
    .withRoot(1)
    .build();
  return createSceneRuntime(scene);
}

describe("visibility tree interaction mapping", () => {
  it("maps a repeated assembly occurrence to only its descendant instances", () => {
    const targets = interactionTargetsForRow(runtime(), { kind: "assembly", nodeId: "1/0" });
    expect(targets).toEqual([{ kind: "instance", instanceId: "1/0/0" }]);
  });

  it("maps a part row to one placement, not every reusable part copy", () => {
    const targets = interactionTargetsForRow(runtime(), {
      kind: "instance",
      instanceId: "1/1/0",
    });
    expect(targets).toEqual([{ kind: "instance", instanceId: "1/1/0" }]);
  });

  it("maps a body row to its exact instance/body identity", () => {
    expect(
      interactionTargetsForRow(runtime(), {
        kind: "body",
        instanceId: "1/0/0",
        bodyId: 4,
      }),
    ).toEqual([{ kind: "body", instanceId: "1/0/0", bodyId: 4 }]);
  });

  it("returns an empty list for an empty assembly occurrence", () => {
    expect(interactionTargetsForRow(runtime(), { kind: "assembly", nodeId: "1/0/1" })).toEqual([]);
  });
});
