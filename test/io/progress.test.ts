import { describe, expect, it } from "vitest";
import {
  createCancellationToken,
  noopProgress,
  OperationCancelledError,
} from "../../src/io/progress";

describe("createCancellationToken", () => {
  it("starts un-cancelled and flips when cancel is called", () => {
    const source = createCancellationToken();
    expect(source.token.cancelled).toBe(false);
    source.cancel();
    expect(source.token.cancelled).toBe(true);
  });
});

describe("OperationCancelledError", () => {
  it("carries a descriptive name", () => {
    expect(new OperationCancelledError().name).toBe("OperationCancelledError");
  });
});

describe("noopProgress", () => {
  it("accepts updates without throwing", () => {
    expect(() => {
      noopProgress({ fraction: 0.5, message: "halfway" });
    }).not.toThrow();
  });
});
