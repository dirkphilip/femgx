import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanupRepos, makeRepo } from "./support";

const SCRIPT_PATH = fileURLToPath(
  new URL("../../../scripts/duplicates/check-bodies.mjs", import.meta.url),
);

afterEach(cleanupRepos);

function runCheck(
  root: string,
  ignorePath?: string,
): { readonly status: number; readonly stdout: string; readonly stderr: string } {
  const args = [SCRIPT_PATH, root];
  if (ignorePath !== undefined) args.push("--ignore", ignorePath);
  const result = spawnSync(process.execPath, args, { encoding: "utf8" });
  return { status: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
}

describe("duplicates/check-bodies", () => {
  it("prints nothing when function bodies differ despite the same name", () => {
    const root = makeRepo({
      "src/a.ts":
        "function clamp(value: number, min: number, max: number): number {\n  return Math.min(max, Math.max(min, value));\n}\n",
      "src/b.ts":
        "function clamp(value: number, min: number, max: number): number {\n  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));\n}\n",
    });
    const result = runCheck(root);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
  });

  it("keeps literal values in structural fingerprints", () => {
    const root = makeRepo({
      "src/a.ts": 'function first(): void { console.log("first", 1); }\n',
      "src/b.ts": 'function second(): void { console.log("second", 2); }\n',
    });
    expect(runCheck(root).stdout).toBe("");
  });

  it("reports identical function bodies with different names across files", () => {
    const root = makeRepo({
      "src/a.ts":
        "function clamp(value: number, min: number, max: number): number {\n  return Math.min(max, Math.max(min, value));\n}\n",
      "src/b.ts":
        "function limit(value: number, min: number, max: number): number {\n  return Math.min(max, Math.max(min, value));\n}\n",
    });
    const result = runCheck(root);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Same function body in 2 file(s)");
    expect(result.stdout).toContain("src/a.ts:1 clamp");
    expect(result.stdout).toContain("src/b.ts:1 limit");
  });

  it("does not match interfaces that only share a property count", () => {
    const root = makeRepo({
      "src/a.ts":
        "interface Alpha {\n  readonly forward: Vec3;\n  readonly right: Vec3;\n  readonly up: Vec3;\n}\n",
      "src/b.ts":
        "interface Beta {\n  readonly edge: Edge;\n  readonly a: Vec3;\n  readonly b: Vec3;\n}\n",
    });
    const result = runCheck(root);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
  });

  it("reports identical interface bodies with different names", () => {
    const root = makeRepo({
      "src/a.ts": "interface Alpha {\n  readonly value: number;\n  readonly label: string;\n}\n",
      "src/b.ts": "interface Beta {\n  readonly count: number;\n  readonly title: string;\n}\n",
    });
    const result = runCheck(root);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Same interface body in 2 file(s)");
    expect(result.stdout).toContain("src/a.ts:1 Alpha");
    expect(result.stdout).toContain("src/b.ts:1 Beta");
  });

  it("reports empty declaration bodies instead of applying a hidden size threshold", () => {
    const root = makeRepo({
      "src/a.ts": "interface Alpha {}\n",
      "src/b.ts": "interface Beta {}\n",
    });
    const result = runCheck(root);
    expect(result.stdout).toContain("Same interface body in 2 file(s)");
  });

  it("reports identical type alias bodies with different names", () => {
    const root = makeRepo({
      "src/a.ts": "type First = { readonly value: number; readonly label: string };\n",
      "src/b.ts": "type Second = { readonly count: number; readonly title: string };\n",
    });
    const result = runCheck(root);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Same type body in 2 file(s)");
    expect(result.stdout).toContain("src/a.ts:1 First");
    expect(result.stdout).toContain("src/b.ts:1 Second");
  });

  it("does not match validation helpers that only share control flow", () => {
    const root = makeRepo({
      "src/a.ts":
        "function validateElementId(id: number): void {\n  if (!Number.isSafeInteger(id) || id < 0 || id > MAX_ELEMENT_ID) {\n    throw new Error(`Element id must be a safe integer in [0, ${MAX_ELEMENT_ID}], got ${id}`);\n  }\n}\n",
      "src/b.ts":
        "function validatePartId(id: number): void {\n  if (!Number.isSafeInteger(id) || id < 0 || id > MAX_PART_ID) {\n    throw new Error(`Part id ${id} must be a finite integer in [0, ${MAX_PART_ID}]`);\n  }\n}\n",
    });
    const result = runCheck(root);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
  });

  it("does not match tuple and object types with the same arity", () => {
    const root = makeRepo({
      "src/a.ts": "type Tuple3 = readonly [number, number, number];\n",
      "src/b.ts":
        "interface Object3 {\n  readonly x: number;\n  readonly y: number;\n  readonly z: number;\n}\n",
    });
    const result = runCheck(root);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
  });

  it("ignores configured file and name entries", () => {
    const root = makeRepo({
      "src/a.ts":
        "function clamp(value: number, min: number, max: number): number {\n  return Math.min(max, Math.max(min, value));\n}\n",
      "src/b.ts":
        "function limit(value: number, min: number, max: number): number {\n  return Math.min(max, Math.max(min, value));\n}\n",
    });
    const ignorePath = join(root, "ignores.json");
    writeFileSync(
      ignorePath,
      JSON.stringify({ entries: [{ file: "src/b.ts", name: "limit" }] }, null, 2),
    );
    const result = runCheck(root, ignorePath);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
  });

  it("loads ignore entries relative to the scan root", () => {
    const root = makeRepo({
      "src/a.ts":
        "function one(): void {\n  const total = 0;\n  for (let index = 0; index < 4; index += 1) total += index;\n  return total;\n}\n",
      "src/b.ts":
        "function two(): void {\n  const total = 0;\n  for (let index = 0; index < 4; index += 1) total += index;\n  return total;\n}\n",
    });
    expect(runCheck(root).stdout).toContain("Same function body in 2 file(s)");
    writeFileSync(
      join(root, "ignores.json"),
      JSON.stringify({ entries: [{ file: "src/a.ts", name: "one", kind: "function" }] }),
    );
    expect(runCheck(root, join(root, "ignores.json")).stdout).toBe("");
  });

  it("requires ignore entries to declare file and name", () => {
    const root = makeRepo({});
    const ignorePath = join(root, "ignores.json");
    writeFileSync(ignorePath, JSON.stringify({ entries: [{ file: "src/a.ts" }] }));
    const result = runCheck(root, ignorePath);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('require string "file" and "name"');
  });
});
