import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const SCRIPT_PATH = fileURLToPath(
  new URL("../../scripts/check-merge-conflicts.mjs", import.meta.url),
);

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeRepo(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "check-merge-conflicts-"));
  tempDirs.push(dir);
  execFileSync("git", ["init", "--quiet"], { cwd: dir });
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content);
  }
  execFileSync("git", ["add", ...Object.keys(files)], { cwd: dir });
  return dir;
}

function runCheck(dir: string): { status: number; stderr: string } {
  const result = spawnSync(process.execPath, [SCRIPT_PATH], { cwd: dir, encoding: "utf8" });
  return { status: result.status ?? -1, stderr: result.stderr };
}

describe("check-merge-conflicts", () => {
  it("passes when staged files contain no conflict markers", () => {
    const dir = makeRepo({ "clean.md": "# clean\n" });
    expect(runCheck(dir).status).toBe(0);
  });

  it("fails when a staged file contains conflict markers", () => {
    const dir = makeRepo({
      "conflict.md": "<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> branch\n",
    });
    const result = runCheck(dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("unresolved merge conflict markers");
  });

  it("ignores whitespace-only errors that prettier fixes", () => {
    const dir = makeRepo({ "trailing.md": "line with trailing space   \n" });
    expect(runCheck(dir).status).toBe(0);
  });
});
