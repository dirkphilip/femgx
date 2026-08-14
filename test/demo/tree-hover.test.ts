import { describe, expect, it } from "vitest";
import {
  interactionTargetForRow,
  visibilityRowTargetsEqual,
} from "../../demo/workbench/visibility-snapshot";

describe("visibility tree hover mapping", () => {
  it("keeps assembly rows UI-only while mapping instance and body identity", () => {
    expect(interactionTargetForRow({ kind: "assembly", occurrenceId: "1/0" })).toBeUndefined();
    expect(interactionTargetForRow({ kind: "instance", instanceId: "1/1/0" })).toEqual({
      kind: "instance",
      instanceId: "1/1/0",
    });
    expect(interactionTargetForRow({ kind: "body", instanceId: "1/0/0", bodyId: 4 })).toEqual({
      kind: "body",
      instanceId: "1/0/0",
      bodyId: 4,
    });
  });

  it("compares row identity so stale leave events cannot clear a newer row", () => {
    const body = { kind: "body", instanceId: "1/0/0", bodyId: 4 } as const;
    expect(visibilityRowTargetsEqual(body, { ...body })).toBe(true);
    expect(visibilityRowTargetsEqual(body, { kind: "body", instanceId: "1/0/0", bodyId: 5 })).toBe(
      false,
    );
    expect(visibilityRowTargetsEqual(body, { kind: "instance", instanceId: "1/0/0" })).toBe(false);
  });
});
