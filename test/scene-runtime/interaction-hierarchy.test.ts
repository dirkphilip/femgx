import { describe, expect, it } from "vitest";
import {
  forEachInstanceUnderAssemblyTargets,
  instanceMatchesAssemblyTarget,
} from "@/scene-runtime/interaction-hierarchy";
import { assemblyPathForInstance } from "@/renderer/picking/assembly-path";
import { buildScene, createPackedSceneRuntime, identityMatrix } from "./scene-runtime/support";

describe("packed interaction hierarchy", () => {
  function runtimeFixture() {
    return createPackedSceneRuntime(
      buildScene(
        1,
        [
          {
            id: 1,
            placements: [
              { kind: "assembly", placementId: "left", assemblyId: 2, transform: identityMatrix() },
              {
                kind: "assembly",
                placementId: "right",
                assemblyId: 2,
                transform: identityMatrix(),
              },
            ],
          },
          {
            id: 2,
            placements: [
              {
                kind: "assembly",
                placementId: "nested",
                assemblyId: 3,
                transform: identityMatrix(),
              },
              { kind: "part", placementId: "part", partId: 7, transform: identityMatrix() },
            ],
          },
          {
            id: 3,
            placements: [
              { kind: "part", placementId: "part", partId: 8, transform: identityMatrix() },
            ],
          },
        ],
        [7, 8],
      ),
    );
  }

  it("resolves a complete root-to-direct-owner path for repeated nested leaves", () => {
    const runtime = runtimeFixture();
    const slot = runtime.getInstanceSlot("1/left/nested/part");
    if (slot === undefined) throw new Error("nested fixture instance is missing");

    expect(assemblyPathForInstance(runtime, slot)).toEqual([
      { assemblyId: 1, assemblyOccurrenceId: "1" },
      { assemblyId: 2, assemblyOccurrenceId: "1/left" },
      { assemblyId: 3, assemblyOccurrenceId: "1/left/nested" },
    ]);
  });

  it("projects definition and occurrence targets to slots without materializing targets", () => {
    const runtime = runtimeFixture();
    const allDefinitionSlots: number[] = [];
    forEachInstanceUnderAssemblyTargets(runtime, new Set([2]), new Set(), (slot) =>
      allDefinitionSlots.push(slot),
    );
    const leftSlots: number[] = [];
    forEachInstanceUnderAssemblyTargets(runtime, new Set(), new Set(["1/left"]), (slot) =>
      leftSlots.push(slot),
    );

    expect(allDefinitionSlots).toHaveLength(4);
    expect(leftSlots).toHaveLength(2);
    const rightPart = runtime.getInstanceSlot("1/right/part");
    const leftPart = runtime.getInstanceSlot("1/left/part");
    expect(rightPart).toBeDefined();
    expect(leftPart).toBeDefined();
    expect(
      instanceMatchesAssemblyTarget(runtime, rightPart ?? -1, new Set(), new Set(["1/left"])),
    ).toBe(false);
    expect(
      instanceMatchesAssemblyTarget(runtime, leftPart ?? -1, new Set(), new Set(["1/left"])),
    ).toBe(true);
  });
});
