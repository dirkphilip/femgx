import { describe, expect, it } from "vitest";
import { createBoltedPlateFixture } from "../../demo/fixture/bolted-plate";
import { createSceneRuntime } from "../../src/index";

describe("public scene runtime", () => {
  it("resolves visibility through stable placement and occurrence handles", () => {
    const runtime = createSceneRuntime(createBoltedPlateFixture().scene);
    const instanceId = runtime.getInstanceIds()[0];
    const nodeId = runtime.getNodeIds()[0];

    expect(instanceId).toBe("1/0/0");
    expect(nodeId).toBe("1");
    expect(runtime.getInstance(instanceId ?? "missing")?.instanceId).toBe(instanceId);
    expect(runtime.getNode(nodeId ?? "missing")?.nodeId).toBe(nodeId);

    const hidden = runtime.setInstanceVisible(instanceId ?? "missing", false);
    expect(hidden.changedInstanceIds).toEqual([instanceId]);
    expect(runtime.isInstanceVisible(instanceId ?? "missing")).toBe(false);

    const shown = runtime.setInstanceVisible(instanceId ?? "missing", true);
    expect(shown.changedInstanceIds).toEqual([instanceId]);
    expect(runtime.isInstanceVisible(instanceId ?? "missing")).toBe(true);
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
    runtime.setAssemblyNodeVisible(first ?? "missing", false);
    expect(runtime.getNode(first ?? "missing")?.effectiveVisible).toBe(false);
    expect(runtime.getNode(second ?? "missing")?.effectiveVisible).toBe(true);
  });
});
