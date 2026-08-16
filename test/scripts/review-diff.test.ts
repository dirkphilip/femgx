import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

function createRepository(): string {
  const root = mkdtempSync(join(tmpdir(), "review-diff-"));
  tempDirs.push(root);
  git(root, "init", "--quiet");
  return root;
}

function writeModules(root: string, directory: string, count: number, start = 1): void {
  const target = join(root, directory);
  mkdirSync(target, { recursive: true });
  for (let index = start; index < start + count; index += 1) {
    writeFileSync(join(target, `module-${index}.ts`), `export const module${index} = ${index};\n`);
  }
}

function commit(root: string, message = "initial"): void {
  git(root, "add", ".");
  git(root, "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", message);
}

function runReview(root: string): string {
  const result = spawnSync(process.execPath, [SCRIPT_PATH, root], {
    encoding: "utf8",
  });
  expect(result.status).toBe(0);
  return result.stdout;
}

describe("review-diff", () => {
  it("prints the worktree status, diff summary, and review prompt", () => {
    const root = createRepository();
    writeFileSync(join(root, "tracked.txt"), "original\n");
    commit(root);

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

  it("stays silent when an addition ends at the threshold", () => {
    const root = createRepository();
    writeModules(root, "src/example", 19);
    commit(root);
    writeModules(root, "src/example", 1, 20);

    expect(runReview(root)).not.toContain("Advisory source-directory module budget");
  });

  it("advises when an addition crosses the threshold", () => {
    const root = createRepository();
    writeModules(root, "src/example", 20);
    commit(root);
    writeModules(root, "src/example", 1, 21);

    expect(runReview(root)).toContain("src/example has 21 direct production TypeScript modules");
  });

  it("advises when an existing outlier receives another module", () => {
    const root = createRepository();
    writeModules(root, "src/example", 21);
    commit(root);
    writeModules(root, "src/example", 1, 22);

    expect(runReview(root)).toContain("src/example has 22 direct production TypeScript modules");
  });

  it("advises when a renamed module enters an over-threshold directory", () => {
    const root = createRepository();
    writeModules(root, "src/source", 1);
    writeModules(root, "src/destination", 20);
    commit(root);
    git(root, "mv", "src/source/module-1.ts", "src/destination/module-21.ts");

    expect(runReview(root)).toContain(
      "src/destination has 21 direct production TypeScript modules",
    );
  });

  it("ignores edits and deletions in an existing outlier", () => {
    const edited = createRepository();
    writeModules(edited, "src/example", 21);
    commit(edited);
    writeFileSync(join(edited, "src/example/module-1.ts"), "export const edited = true;\n");
    expect(runReview(edited)).not.toContain("Advisory source-directory module budget");

    const deleted = createRepository();
    writeModules(deleted, "src/example", 21);
    commit(deleted);
    rmSync(join(deleted, "src/example/module-1.ts"));
    expect(runReview(deleted)).not.toContain("Advisory source-directory module budget");
  });

  it("counts nested directories independently", () => {
    const root = createRepository();
    writeModules(root, "src/example", 20);
    writeModules(root, "src/example/nested", 20);
    commit(root);
    writeModules(root, "src/example/nested", 1, 21);

    const output = runReview(root);
    expect(output).toContain("src/example/nested has 21 direct production TypeScript modules");
    expect(output).not.toContain("src/example has 21");
  });

  it("ignores non-production paths", () => {
    const root = createRepository();
    writeModules(root, "test/example", 20);
    commit(root);
    writeModules(root, "test/example", 1, 21);

    expect(runReview(root)).not.toContain("Advisory source-directory module budget");
  });

  it("does not count root-level source modules", () => {
    const root = createRepository();
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src/root-module.ts"), "export const rootModule = true;\n");
    commit(root);
    writeFileSync(join(root, "src/another.ts"), "export const another = true;\n");

    expect(runReview(root)).not.toContain("Advisory source-directory module budget");
  });

  it("sorts multiple advisories by directory", () => {
    const root = createRepository();
    writeModules(root, "src/zeta", 20);
    writeModules(root, "src/alpha", 20);
    commit(root);
    writeModules(root, "src/zeta", 1, 21);
    writeModules(root, "src/alpha", 1, 21);

    const output = runReview(root);
    expect(output.indexOf("src/alpha has 21")).toBeLessThan(output.indexOf("src/zeta has 21"));
  });
});
