import { describe, expect, it } from "vitest";
import { batchInstancesByPart } from "../../src/runtime/batch";
import { identity } from "../../src/math/mat4";
import type { Instance } from "../../src/scene/types";

const instance = (index: number, partId: number): Instance => ({
  index,
  instanceId: `1/${index}`,
  partId,
  worldTransform: identity(),
});

describe("batchInstancesByPart", () => {
  it("groups instances in deterministic first-seen order", () => {
    const batches = batchInstancesByPart([instance(0, 2), instance(1, 1), instance(2, 2)]);
    expect(batches.map((batch) => batch.partId)).toEqual([2, 1]);
    expect(batches[0]?.instances.map((item) => item.index)).toEqual([0, 2]);
  });
});
