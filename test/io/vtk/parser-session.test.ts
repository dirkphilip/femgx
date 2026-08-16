import { describe, expect, it } from "vitest";
import { createParseSession, finishParse } from "../../../src/io/vtk/parser-session";
import { IoError } from "../../../src/io/diagnostics";

describe("createParseSession", () => {
  it("collects issues without throwing by default", () => {
    const session = createParseSession();
    session.report("test-code", "a problem", { line: 3 });
    expect(session.issues).toEqual([
      { code: "test-code", severity: "error", message: "a problem", position: { line: 3 } },
    ]);
  });

  it("throws immediately in strict mode", () => {
    const session = createParseSession({ strict: true });
    expect(() => {
      session.report("test-code", "a problem");
    }).toThrow(IoError);
  });

  it("reports custom severities", () => {
    const session = createParseSession();
    session.report("w", "warning", undefined, "warning");
    session.report("i", "info", undefined, "info");
    expect(session.issues.map((issue) => issue.severity)).toEqual(["warning", "info"]);
  });
});

describe("finishParse", () => {
  it("appends validation issues to the reported ones", () => {
    const session = createParseSession();
    session.builder.addSet("node", "ghost", [999]);
    const result = finishParse(session);
    expect(result.issues.map((issue) => issue.code)).toEqual(["missing-set-id"]);
    expect(result.model.sets).toHaveLength(1);
  });

  it("throws an IoError carrying all issues in strict mode", () => {
    const session = createParseSession({ strict: true });
    session.builder.addSet("node", "ghost", [999]);
    try {
      finishParse(session, { strict: true });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(IoError);
      expect((error as IoError).issues.map((issue) => issue.code)).toEqual(["missing-set-id"]);
    }
  });
});
