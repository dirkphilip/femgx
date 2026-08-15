import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const SCRIPT_PATH = fileURLToPath(
  new URL("../../scripts/check-folder-structure.mjs", import.meta.url),
);

const tempDirs: string[] = [];

afterEach(() => {
  for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function makeRepo(files: readonly string[]): string {
  const root = mkdtempSync(join(tmpdir(), "check-folder-structure-"));
  tempDirs.push(root);
  for (const file of files) {
    const path = join(root, file);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, "export {};\n");
  }
  return root;
}

function runCheck(root: string): { readonly status: number; readonly stderr: string } {
  const result = spawnSync(process.execPath, [SCRIPT_PATH, root], { encoding: "utf8" });
  return { status: result.status ?? -1, stderr: result.stderr };
}

describe("check-folder-structure", () => {
  it("accepts a clear folder name at the direct-file boundary", () => {
    const root = makeRepo(
      Array.from({ length: 25 }, (_, index) => `src/render-passes/file-${index}.ts`),
    );
    expect(runCheck(root).status).toBe(0);
  });

  it("reports oversized folders with the structure policy", () => {
    const root = makeRepo(
      Array.from({ length: 26 }, (_, index) => `src/renderer/file-${index}.ts`),
    );
    const result = runCheck(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "src/renderer: 26 direct source files exceeds 25; split this folder by clear responsibility using specific lowercase kebab-case child folder names",
    );
  });

  it("rejects vague or non-kebab-case folder names", () => {
    const root = makeRepo(["src/Shared/thing.ts", "demo/utils/tool.ts"]);
    const result = runCheck(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(
      /demo\/utils:[\s\S]*src\/Shared: folder names must be specific lowercase kebab-case domain names/u,
    );
  });

  it("checks newly added top-level source folders and JavaScript variants", () => {
    const root = makeRepo(
      Array.from({ length: 26 }, (_, index) => `packages/new-renderer/file-${index}.cjs`),
    );
    const result = runCheck(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("packages/new-renderer: 26 direct source files exceeds 25");
  });

  it("accepts the direct source-folder boundary", () => {
    const root = makeRepo(
      Array.from({ length: 20 }, (_, index) => `packages/features/feature-${index}/index.ts`),
    );
    expect(runCheck(root).status).toBe(0);
  });

  it("reports folders with too many direct source folders", () => {
    const root = makeRepo(
      Array.from({ length: 21 }, (_, index) => `packages/features/feature-${index}/index.ts`),
    );
    const result = runCheck(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "packages/features: 21 direct source folders exceeds 20; group child folders under clear responsibilities using specific lowercase kebab-case names",
    );
  });

  it("ignores generated and dependency directories", () => {
    const root = makeRepo([
      "node_modules/BadName/package.js",
      "dist/utils/generated.js",
      "dist-demo/Shared/generated.js",
      "coverage/Shared/report.js",
      ".tooling/BadName/tool.js",
    ]);
    expect(runCheck(root).status).toBe(0);
  });

  it("exempts root-level configuration files from the folder limit", () => {
    const root = makeRepo(Array.from({ length: 26 }, (_, index) => `config-${index}.mjs`));
    expect(runCheck(root).status).toBe(0);
  });
});
