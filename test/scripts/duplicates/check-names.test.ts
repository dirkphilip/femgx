import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const SCRIPT_PATH = fileURLToPath(
  new URL("../../../scripts/duplicates/check-names.mjs", import.meta.url),
);

const tempDirs: string[] = [];

afterEach(() => {
  for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function makeRepo(files: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(join(tmpdir(), "check-duplicate-names-"));
  tempDirs.push(root);
  for (const [file, content] of Object.entries(files)) {
    const path = join(root, file);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, content);
  }
  return root;
}

function runCheck(
  root: string,
  ignorePath?: string,
): { readonly status: number; readonly stdout: string; readonly stderr: string } {
  const args = [SCRIPT_PATH, root];
  if (ignorePath !== undefined) args.push("--ignore", ignorePath);
  const result = spawnSync(process.execPath, args, { encoding: "utf8" });
  return { status: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
}

describe("duplicates/check-names", () => {
  it("prints nothing for a source tree without repeated declaration names", () => {
    const root = makeRepo({
      "src/a.ts": "export interface First {}\nexport function second() {}\n",
      "src/b.ts": "export type Third = number;\n",
    });
    const result = runCheck(root);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
  });

  it("reports an interface name declared in two files with file, line, and kind", () => {
    const root = makeRepo({
      "src/a.ts": "export interface Options {}\n",
      "src/b.ts": "export interface Options {}\n",
    });
    const result = runCheck(root);
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
    const result = runCheck(root);
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
    const result = runCheck(root);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
  });

  it("ignores names scoped inside namespaces and ambient module declarations", () => {
    const root = makeRepo({
      "src/a.ts": "export namespace outer { export interface Inner {} }\n",
      "src/b.ts": 'declare module "draco3dgltf" { export interface Inner {} }\n',
      "src/c.ts": "export const Inner = 1;\n",
    });
    const result = runCheck(root);
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
    const result = runCheck(root, ignorePath);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
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
