import { describe, expect, it } from "vitest";
import { GpuCostAccumulator } from "../../src/renderer/gpu-cost";

describe("GPU cost accounting", () => {
  it("keeps detached counters and physical target estimates in its snapshot", () => {
    const cost = new GpuCostAccumulator();
    cost.pass("opaque");
    cost.draw("opaque", 12, 3);
    cost.write("instance", 96);
    cost.cpu("instance-scan", 4);
    cost.targets(1600, 1200, 2);

    const snapshot = cost.snapshot();
    expect(snapshot.passes.opaque).toBe(1);
    expect(snapshot.draws.opaque).toEqual({ calls: 1, indices: 12, instances: 3 });
    expect(snapshot.writes.instance).toEqual({ calls: 1, bytes: 96 });
    expect(snapshot.cpu["instance-scan"]).toBe(4);
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
    expect(cleared.passes).toEqual({ opaque: 0, transparency: 0, composite: 0, pick: 0 });
    expect(cleared.draws.opaque).toEqual({ calls: 0, indices: 0, instances: 0 });
    expect(cleared.writes.instance).toEqual({ calls: 0, bytes: 0 });
    expect(cleared.cpu).toEqual({ "instance-scan": 0, "order-rebuild": 0, "call-rebuild": 0 });
    expect(cleared.targets).toBeUndefined();
  });
});
