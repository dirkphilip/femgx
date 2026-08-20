import { fileURLToPath } from "node:url";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanupRepos, makeRepo } from "./support";
import { runCheck } from "../support/run-check";

const SCRIPT_PATH = fileURLToPath(
  new URL("../../../scripts/duplicates/check-fragments.mjs", import.meta.url),
);

afterEach(cleanupRepos);

describe("duplicates/check-fragments", () => {
  it("prints nothing when statement operations differ", () => {
    const root = makeRepo({
      "src/a.ts":
        "function alpha(): number {\n  const left = 1;\n  const right = 2;\n  const total = left + right;\n  const scaled = total * 3;\n  return scaled;\n}\n",
      "src/b.ts":
        "function beta(): number {\n  const first = 1;\n  const second = 2;\n  const sum = first * second;\n  const scaled = sum * 3;\n  return scaled;\n}\n",
    });
    const result = runCheck(SCRIPT_PATH, [root, "--min-lines", "3", "--min-statements", "3"], root);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
  });

  it("reports rename-invariant statement fragments across files", () => {
    const root = makeRepo({
      "src/a.ts":
        "function alpha(): number {\n  const left = 1;\n  const right = 2;\n  const total = left + right;\n  return total;\n}\n",
      "src/b.ts":
        "function beta(): number {\n  const first = 1;\n  const second = 2;\n  const sum = first + second;\n  return sum;\n}\n",
    });
    const result = runCheck(SCRIPT_PATH, [root, "--min-lines", "3", "--min-statements", "3"], root);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Fragment clone (");
    expect(result.stdout).toContain("src/a.ts:");
    expect(result.stdout).toContain("src/b.ts:");
  });

  it("reports only the maximal shared statement window", () => {
    const root = makeRepo({
      "src/a.ts":
        "function alpha(): number {\n  const a = 1;\n  const b = 2;\n  const c = 3;\n  const d = a + b + c;\n  return d;\n}\n",
      "src/b.ts":
        "function beta(): number {\n  const w = 1;\n  const x = 2;\n  const y = 3;\n  const z = w + x + y;\n  return z;\n}\n",
    });
    const result = runCheck(SCRIPT_PATH, [root, "--min-lines", "3", "--min-statements", "3"], root);
    expect(result.stdout.match(/^Fragment clone /gmu)).toHaveLength(1);
    expect(result.stdout).toContain("Fragment clone (5 lines, 5 statements");
  });

  it("keeps a shorter clone when it also occurs outside the maximal pair", () => {
    const shared = "  const a = 1;\n  const b = 2;\n  const c = 3;\n  const d = a + b + c;\n";
    const root = makeRepo({
      "src/a.ts": `function alpha(): number {\n${shared}  return d;\n}\n`,
      "src/b.ts": `function beta(): number {\n${shared}  return d;\n}\n`,
      "src/c.ts": `function gamma(): void {\n${shared}}\n`,
    });
    const result = runCheck(SCRIPT_PATH, [root, "--min-lines", "3", "--min-statements", "3"], root);
    expect(result.stdout).toContain("5 statements, 2 files");
    expect(result.stdout).toContain("4 statements, 3 files");
  });

  it("reports every qualifying cluster unless an explicit cap is requested", () => {
    const functions = Array.from(
      { length: 105 },
      (_, index) =>
        `function match${index}(): void {\n  const value = ${index};\n  const next = value + ${index + 1};\n  console.log(next);\n}\n`,
    ).join("");
    const root = makeRepo({ "src/a.ts": functions, "src/b.ts": functions });
    const args = ["--min-lines", "3", "--min-statements", "3"];
    expect(
      runCheck(SCRIPT_PATH, [root, ...args], root).stdout.match(/^Fragment clone /gmu),
    ).toHaveLength(105);
    expect(
      runCheck(SCRIPT_PATH, [root, ...args, "--max-reports", "7"], root).stdout.match(
        /^Fragment clone /gmu,
      ),
    ).toHaveLength(7);
  });

  it("sorts longer fragments before shorter ones and groups by line count", () => {
    const root = makeRepo({
      "src/a.ts":
        "function longMatch(): void {\n  const a = 1;\n  const b = 2;\n  const c = 3;\n  const d = 4;\n  const e = a + b + c + d;\n  console.log(e);\n}\nfunction shortMatch(): void {\n  const x = 10;\n  const y = 20;\n  const z = x + y;\n  console.log(z);\n}\n",
      "src/b.ts":
        "function longMatch(): void {\n  const p = 1;\n  const q = 2;\n  const r = 3;\n  const s = 4;\n  const t = p + q + r + s;\n  console.log(t);\n}\nfunction shortMatch(): void {\n  const m = 10;\n  const n = 20;\n  const o = m + n;\n  console.log(o);\n}\n",
    });
    const result = runCheck(SCRIPT_PATH, [root, "--min-lines", "3", "--min-statements", "3"], root);
    const longIndex = result.stdout.indexOf("-line fragment clones:");
    const shortHeader = result.stdout.lastIndexOf("-line fragment clones:");
    expect(longIndex).toBeGreaterThanOrEqual(0);
    expect(shortHeader).toBeGreaterThan(longIndex);
    expect(result.stdout.indexOf("6-line fragment clones:")).toBeLessThan(
      result.stdout.indexOf("4-line fragment clones:"),
    );
  });

  it("respects configured line-range ignores", () => {
    const root = makeRepo({
      "src/a.ts":
        "function alpha(): number {\n  const left = 1;\n  const right = 2;\n  const total = left + right;\n  return total;\n}\n",
      "src/b.ts":
        "function beta(): number {\n  const first = 1;\n  const second = 2;\n  const sum = first + second;\n  return sum;\n}\n",
    });
    const ignorePath = join(root, "ignores.json");
    writeFileSync(
      ignorePath,
      JSON.stringify({ entries: [{ file: "src/b.ts", startLine: 2, endLine: 5 }] }),
    );
    const result = runCheck(
      SCRIPT_PATH,
      [root, "--min-lines", "3", "--min-statements", "3", "--ignore", ignorePath],
      root,
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
  });

  it("requires ignore entries to declare a file path", () => {
    const root = makeRepo({});
    const ignorePath = join(root, "ignores.json");
    writeFileSync(ignorePath, JSON.stringify({ entries: [{ startLine: 1 }] }));
    const result = runCheck(SCRIPT_PATH, [root, "--ignore", ignorePath], root);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('require a string "file"');
  });
});
