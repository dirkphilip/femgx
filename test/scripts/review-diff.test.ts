import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const SCRIPT_PATH = fileURLToPath(new URL("../../scripts/review-diff.mjs", import.meta.url));
const tempDirs: string[] = [];

afterEach(() => {
  for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function git(root: string, ...args: string[]): void {
  execFileSync("git", args, { cwd: root });
}

describe("review-diff", () => {
  it("prints the worktree status, diff summary, and review prompt", () => {
    const root = mkdtempSync(join(tmpdir(), "review-diff-"));
    tempDirs.push(root);
    git(root, "init", "--quiet");
    writeFileSync(join(root, "tracked.txt"), "original\n");
    git(root, "add", "tracked.txt");
    git(
      root,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "-m",
      "initial",
    );

    writeFileSync(join(root, "tracked.txt"), "changed\n");
    writeFileSync(join(root, "untracked.txt"), "new\n");

    const result = spawnSync(process.execPath, [SCRIPT_PATH, root], {
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(" M tracked.txt");
    expect(result.stdout).toContain("?? untracked.txt");
    expect(result.stdout).toContain("1 file changed, 1 insertion(+), 1 deletion(-)");
    expect(result.stdout).toContain("check for unnecessary code");
  });
});
