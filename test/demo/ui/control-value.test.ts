import { describe, expect, it } from "vitest";
import { controlValue } from "../../../demo/workbench/ui/control-value";

describe("controlValue", () => {
  it("accepts only string values from event current targets", () => {
    expect(controlValue({ currentTarget: { value: "element" } })).toBe("element");
    expect(controlValue({ currentTarget: { value: 1 } })).toBeUndefined();
    expect(controlValue({ target: { value: "element" } })).toBeUndefined();
    expect(controlValue(undefined)).toBeUndefined();
  });
});
