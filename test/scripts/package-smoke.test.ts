import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parsePackResult, runCommand } from "../../scripts/package-smoke-helpers.mjs";

describe("package smoke helpers", () => {
  it.each([
    ["empty array", "[]", /exactly one JSON result/],
    ["multiple results", "[{}, {}]", /exactly one JSON result/],
    ["missing filename", "[{}]", /non-empty filename/],
    ["missing files", '[{"filename":"femgx.tgz"}]', /files array/],
    ["malformed JSON", "not json", /valid JSON/],
  ] as const)("rejects %s pack output", (_name, stdout, message) => {
    expect(() => parsePackResult(stdout, "pack warning")).toThrow(message);
  });

  it("accepts exactly one complete pack result", () => {
    const result = parsePackResult(
      '[{"filename":"femgx-0.1.0.tgz","files":[{"path":"dist/femgx.js"}]}]',
    );
    expect(result.filename).toBe("femgx-0.1.0.tgz");
    expect(result.files).toHaveLength(1);
  });

  it("accepts npm lifecycle output before the pack result", () => {
    const result = parsePackResult(
      '> femgx@0.1.0 prepare\n> husky\n[{"filename":"femgx-0.1.0.tgz","files":[]}]',
    );
    expect(result.filename).toBe("femgx-0.1.0.tgz");
  });

  it("reports a failed child process with both output streams", () => {
    expect(() =>
      runCommand(
        process.execPath,
        ["-e", 'console.log("stdout marker"); console.error("stderr marker"); process.exit(7);'],
        join(process.cwd(), "test"),
      ),
    ).toThrow(/exit status: 7[\s\S]*stdout marker[\s\S]*stderr marker/);
  });
});
