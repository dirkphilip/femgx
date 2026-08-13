import { describe, expect, it } from "vitest";
import { createBoltedPlateFixture } from "../../demo/fixture/bolted-plate";
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
});
