import { describe, expect, it } from "vitest";
import { instanceToTarget, resolvePick } from "../src/pick";
import { identity } from "../src/mat4";

const instances = [
  { index: 0, instanceId: "1/0", partId: 1, worldTransform: identity() },
  { index: 1, instanceId: "1/1", partId: 2, worldTransform: identity() },
];

describe("resolvePick", () => {
  it("resolves a valid pick id to an instance", () => {
    expect(resolvePick(instances, 1)?.partId).toBe(2);
  });

  it("returns undefined for out-of-range pick ids", () => {
    expect(resolvePick(instances, -1)).toBeUndefined();
    expect(resolvePick(instances, 99)).toBeUndefined();
  });
});

describe("instanceToTarget", () => {
  it("maps to a part target when preferPart is set", () => {
    const target = resolvePick(instances, 0);
    if (target === undefined) {
      throw new Error("expected instance");
    }
    expect(instanceToTarget(target, true)).toEqual({ kind: "part", partId: 1 });
  });

  it("maps to an instance target by default", () => {
    const target = resolvePick(instances, 0);
    if (target === undefined) {
      throw new Error("expected instance");
    }
    expect(instanceToTarget(target, false)).toEqual({ kind: "instance", instanceId: "1/0" });
  });
});
