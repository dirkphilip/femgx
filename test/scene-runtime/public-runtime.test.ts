import { describe, expect, it } from "vitest";
import { createBoltedPlateFixture } from "../../demo/fixture/bolted-plate";
import { identity } from "../../src/math/mat4";
import { createSceneRuntime } from "../../src/index";

describe("public scene runtime", () => {
  it("exposes stable placement and occurrence queries", () => {
    const runtime = createSceneRuntime(createBoltedPlateFixture().scene);
    const instanceId = runtime.getInstanceIds()[0];
    const nodeId = runtime.getNodeIds()[0];

    expect(instanceId).toBe("1/0/0");
    expect(nodeId).toBe("1");
    expect(runtime.getInstance(instanceId ?? "missing")?.instanceId).toBe(instanceId);
    expect(runtime.getNode(nodeId ?? "missing")?.nodeId).toBe(nodeId);

    expect(runtime.isInstanceVisible(instanceId ?? "missing")).toBe(true);
    expect(runtime).not.toHaveProperty("setInstanceVisible");
    expect(runtime).not.toHaveProperty("setPartVisible");
    expect(runtime).not.toHaveProperty("setAssemblyNodeVisible");
    expect(runtime).not.toHaveProperty("setAssemblyVisible");
    expect(runtime).not.toHaveProperty("getNodeTransform");
    expect(runtime).not.toHaveProperty("getNodeWorldTransform");
    expect(runtime.getNode(nodeId ?? "missing")).not.toHaveProperty("transform");
    expect(runtime.getNode(nodeId ?? "missing")).not.toHaveProperty("worldTransform");
  });

  it("keeps repeated assembly occurrences independently addressable", () => {
    const runtime = createSceneRuntime(createBoltedPlateFixture().scene);
    const occurrenceIds = runtime
      .getNodeIds()
      .filter((nodeId) => runtime.getNode(nodeId)?.assemblyId === 4);

    expect(occurrenceIds.length).toBeGreaterThan(1);
    const first = occurrenceIds[0];
    const second = occurrenceIds[1];
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(runtime.getNode(first ?? "missing")?.effectiveVisible).toBe(true);
    expect(runtime.getNode(second ?? "missing")?.effectiveVisible).toBe(true);
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
