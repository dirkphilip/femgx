import { describe, expect, it } from "vitest";
import { GpuCostAccumulator } from "@/renderer/diagnostics/cost";

describe("GPU cost accounting", () => {
  it("keeps detached counters and physical target estimates in its snapshot", () => {
    const cost = new GpuCostAccumulator();
    cost.pass("opaque");
    cost.draw("opaque", 12, 3);
    cost.admission("minimal");
    cost.admission("topology");
    cost.admission("feature");
    cost.write("instance", 96);
    cost.cpu("instance-scan", 4);
    cost.allocateBuffer(128);
    cost.releaseBuffer(64);
    cost.invalidateBindGroups(2);
    cost.targets(1600, 1200, 2);

    const snapshot = cost.snapshot();
    expect(snapshot.passes.opaque).toBe(1);
    expect(snapshot.draws.opaque).toEqual({ calls: 1, indices: 12, instances: 3 });
    expect(snapshot.admissions).toEqual({ minimal: 1, topology: 1, feature: 1 });
    expect(snapshot.writes.instance).toEqual({ calls: 1, bytes: 96 });
    expect(snapshot.cpu["instance-scan"]).toBe(4);
    expect(snapshot.memory).toEqual({
      allocatedBytes: 128,
      releasedBytes: 64,
      bufferCreates: 1,
      bufferDestroys: 1,
      bindGroupInvalidations: 2,
    });
    expect(snapshot.targets).toEqual({
      width: 1600,
      height: 1200,
      devicePixelRatio: 2,
      sampleCount: 4,
      weightedTransparency: true,
      estimatedBytes: 1600 * 1200 * 81,
    });

    cost.reset();
    const cleared = cost.snapshot();
    expect(cleared.passes).toEqual({
      opaque: 0,
      transparency: 0,
      composite: 0,
      pick: 0,
    });
    expect(cleared.draws.opaque).toEqual({ calls: 0, indices: 0, instances: 0 });
    expect(cleared.admissions).toEqual({ minimal: 0, topology: 0, feature: 0 });
    expect(cleared.writes.instance).toEqual({ calls: 0, bytes: 0 });
    expect(cleared.cpu).toEqual({
      "instance-scan": 0,
      "part-scan": 0,
      "order-rebuild": 0,
      "call-rebuild": 0,
      "definition-validation": 0,
    });
    expect(cleared.memory).toEqual({
      allocatedBytes: 0,
      releasedBytes: 0,
      bufferCreates: 0,
      bufferDestroys: 0,
      bindGroupInvalidations: 0,
    });
    expect(cleared.targets).toBeUndefined();
  });
});
