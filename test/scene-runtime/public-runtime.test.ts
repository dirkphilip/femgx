import { describe, expect, it } from "vitest";
import { createBoltedPlateFixture } from "../../demo/fixture/bolted-plate";
import { identity } from "../../src/math/mat4";
import { createSceneRuntime } from "../../src/index";

describe("public scene runtime", () => {
  it("exposes stable placement and occurrence queries", () => {
    const runtime = createSceneRuntime(createBoltedPlateFixture().scene);
    const instanceId = runtime.getInstanceIds()[0];
    const occurrenceId = runtime.getOccurrenceIds()[0];

    expect(instanceId).toBe("1/0/0");
    expect(occurrenceId).toBe("1");
    expect(runtime.occurrenceCount).toBe(runtime.getOccurrenceIds().length);
    expect(runtime.getInstance(instanceId ?? "missing")?.instanceId).toBe(instanceId);
    expect(runtime.getOccurrence(occurrenceId ?? "missing")?.occurrenceId).toBe(occurrenceId);

    expect(runtime.isInstanceVisible(instanceId ?? "missing")).toBe(true);
    expect(runtime).not.toHaveProperty("setInstanceVisible");
    expect(runtime).not.toHaveProperty("setPartVisible");
    expect(runtime).not.toHaveProperty("setAssemblyOccurrenceVisible");
    expect(runtime).not.toHaveProperty("setAssemblyVisible");
    expect(runtime).not.toHaveProperty("getNodeTransform");
    expect(runtime).not.toHaveProperty("getNodeWorldTransform");
    expect(runtime.getOccurrence(occurrenceId ?? "missing")).not.toHaveProperty("transform");
    expect(runtime.getOccurrence(occurrenceId ?? "missing")).not.toHaveProperty("worldTransform");
  });

  it("keeps repeated assembly occurrences independently addressable", () => {
    const runtime = createSceneRuntime(createBoltedPlateFixture().scene);
    const occurrenceIds = runtime
      .getOccurrenceIds()
      .filter((occurrenceId) => runtime.getOccurrence(occurrenceId)?.assemblyId === 4);

    expect(occurrenceIds.length).toBeGreaterThan(1);
    const first = occurrenceIds[0];
    const second = occurrenceIds[1];
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(runtime.getOccurrence(first ?? "missing")?.effectiveVisible).toBe(true);
    expect(runtime.getOccurrence(second ?? "missing")?.effectiveVisible).toBe(true);
  });

  it("rejects a structurally forged scene before public runtime admission", () => {
    const source = createBoltedPlateFixture().scene;
    const root = source.assemblies.get(source.rootAssemblyId);
    expect(root).toBeDefined();
    const invalid = {
      ...source,
      assemblies: new Map(source.assemblies).set(source.rootAssemblyId, {
        ...(root as NonNullable<typeof root>),
        placements: [{ kind: "assembly", assemblyId: 999, transform: identity() }],
      }),
    };

    expect(() => createSceneRuntime(invalid)).toThrow(/references missing assembly 999/);
  });
});
