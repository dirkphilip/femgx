import { describe, expect, it } from "vitest";
import { boundaryFaceRefs, ElementShape } from "femgx/model";
import { createSceneOccurrenceSnapshot } from "@/scene-runtime/occurrences";
import { createTet4Fixture, TET4_FIXTURE_IDS } from "../../../fixtures/fe/tet4";

describe("createTet4Fixture", () => {
  it("publishes stable shared-node topology and boundary faces", () => {
    const { elementModel, part } = createTet4Fixture();

    expect(Array.from(elementModel.nodeIds)).toEqual(TET4_FIXTURE_IDS.nodeIds);
    expect(Array.from(elementModel.elementIds)).toEqual(TET4_FIXTURE_IDS.elementIds);
    expect([...elementModel.elements]).toEqual([
      { id: 101, shape: ElementShape.Tet4, nodeIds: [10, 11, 12, 13] },
      { id: 102, shape: ElementShape.Tet4, nodeIds: [12, 11, 10, 14] },
    ]);
    expect([...(elementModel.bodies ?? [])]).toEqual([
      { id: 1, name: "Tet4 fixture body", elementIds: [101, 102] },
    ]);
    expect(boundaryFaceRefs([...elementModel.elements])).toHaveLength(6);
    expect(part.elements?.get(101)?.shape).toBe(ElementShape.Tet4);
    expect(part.elements?.get(102)?.shape).toBe(ElementShape.Tet4);
  });

  it("publishes one explicitly identified placement through the public scene path", () => {
    const { scene } = createTet4Fixture();
    const assembly = scene.assemblies.get(TET4_FIXTURE_IDS.assemblyId);

    expect(scene.parts.has(TET4_FIXTURE_IDS.partId)).toBe(true);
    expect(scene.rootAssemblyId).toBe(TET4_FIXTURE_IDS.assemblyId);
    expect(assembly?.placements).toHaveLength(1);
    const placement = assembly?.placements[0];
    if (placement === undefined) throw new Error("Tet4 fixture placement is missing");
    expect(placement).toMatchObject({
      kind: "part",
      placementId: TET4_FIXTURE_IDS.placementId,
      partId: TET4_FIXTURE_IDS.partId,
    });
    expect(placement.transform).toBeInstanceOf(Float32Array);
    expect([...createSceneOccurrenceSnapshot(scene).partOccurrences()]).toHaveLength(1);
  });

  it("rebuilds identical authored values without eager shared state", () => {
    const first = createTet4Fixture();
    const second = createTet4Fixture();

    expect(first.elementModel.nodes).toEqual(second.elementModel.nodes);
    expect(first.elementModel.elementNodeIds).toEqual(second.elementModel.elementNodeIds);
    expect(first.scene).not.toBe(second.scene);
    expect(first.part).not.toBe(second.part);
  });
});
