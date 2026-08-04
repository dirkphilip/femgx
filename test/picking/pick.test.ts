import { describe, expect, it } from "vitest";
import { instanceToTarget, resolvePick, resolvePickTarget } from "../../src/picking/pick";
import { identity } from "../../src/math/mat4";

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

describe("resolvePickTarget", () => {
  it("resolves a hit with an element id to an element target", () => {
    expect(resolvePickTarget(instances, 2, 5)).toEqual({
      kind: "element",
      partId: 2,
      instanceId: "1/1",
      elementId: 4,
    });
  });

  it("resolves a hit without an element id to an instance target", () => {
    expect(resolvePickTarget(instances, 2, 0)).toEqual({ kind: "instance", instanceId: "1/1" });
  });

  it("returns undefined when the instance pick id misses", () => {
    expect(resolvePickTarget(instances, 0, 3)).toBeUndefined();
    expect(resolvePickTarget(instances, 99, 3)).toBeUndefined();
  });
});
