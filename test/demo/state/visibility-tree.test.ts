import { describe, expect, it } from "vitest";
import { createBoltedPlateFixture } from "../../../demo/fixtures/bolted-plate";
import { assemblyName } from "../../../demo/workbench/state/visibility-tree";

describe("assemblyName", () => {
  it("reads the optional display name from a registered assembly", () => {
    const { scene, assemblyIds } = createBoltedPlateFixture();
    expect(assemblyName(scene.assemblies.get(assemblyIds.root))).toBe("Bolted joint");
    expect(assemblyName(scene.assemblies.get(assemblyIds.fastener))).toBe("Fastener");
    expect(assemblyName(undefined)).toBeUndefined();
  });
});
