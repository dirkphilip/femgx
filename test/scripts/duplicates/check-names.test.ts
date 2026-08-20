import { fileURLToPath } from "node:url";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanupRepos, makeRepo } from "./support";
import { runCheck } from "../support/run-check";

const SCRIPT_PATH = fileURLToPath(
  new URL("../../../scripts/duplicates/check-names.mjs", import.meta.url),
);

afterEach(cleanupRepos);

describe("duplicates/check-names", () => {
  it("prints nothing for a source tree without repeated declaration names", () => {
    const root = makeRepo({
      "src/a.ts": "export interface First {}\nexport function second() {}\n",
      "src/b.ts": "export type Third = number;\n",
    });
    const result = runCheck(SCRIPT_PATH, [root], root);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
  });

  it("reports an interface name declared in two files with file, line, and kind", () => {
    const root = makeRepo({
      "src/a.ts": "export interface Options {}\n",
      "src/b.ts": "export interface Options {}\n",
    });
    const result = runCheck(SCRIPT_PATH, [root], root);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('"Options" is declared in 2 file(s)');
    expect(result.stdout).toContain("src/a.ts:1 (interface)");
    expect(result.stdout).toContain("src/b.ts:1 (interface)");
  });

  it("reports duplicate names across different declaration kinds", () => {
    const root = makeRepo({
      "src/a.ts": "export function draw() {}\n",
      "src/b.ts": "export interface draw {}\n",
    });
    const result = runCheck(SCRIPT_PATH, [root], root);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('"draw" is declared in 2 file(s)');
    expect(result.stdout).toContain("src/a.ts:1 (function)");
    expect(result.stdout).toContain("src/b.ts:1 (interface)");
  });

  it("ignores same-file declaration merging and overloads", () => {
    const root = makeRepo({
      "src/a.ts":
        "export interface Merge {}\nexport class Merge {}\nfunction load(x: string): void;\nfunction load(x: number): void;\nfunction load() {}\n",
      "src/b.ts": "export interface Other {}\n",
    });
    const result = runCheck(SCRIPT_PATH, [root], root);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
  });

  it("ignores names scoped inside namespaces and ambient module declarations", () => {
    const root = makeRepo({
      "src/a.ts": "export namespace outer { export interface Inner {} }\n",
      "src/b.ts": 'declare module "draco3dgltf" { export interface Inner {} }\n',
      "src/c.ts": "export const Inner = 1;\n",
    });
    const result = runCheck(SCRIPT_PATH, [root], root);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
  });

  it("respects configured file and name ignores", () => {
    const root = makeRepo({
      "src/a.ts": "export interface Options {}\n",
      "src/b.ts": "export interface Options {}\n",
    });
    const ignorePath = join(root, "ignores.json");
    writeFileSync(
      ignorePath,
      JSON.stringify({ entries: [{ file: "src/b.ts", name: "Options", kind: "interface" }] }),
    );
    const result = runCheck(SCRIPT_PATH, [root, "--ignore", ignorePath], root);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
  });

  it("requires ignore entries to declare file and name", () => {
    const root = makeRepo({});
    const ignorePath = join(root, "ignores.json");
    writeFileSync(ignorePath, JSON.stringify({ entries: [{ file: "src/a.ts" }] }));
    const result = runCheck(SCRIPT_PATH, [root, "--ignore", ignorePath], root);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('require string "file" and "name"');
  });
});
