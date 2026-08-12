import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const SCRIPT_PATH = fileURLToPath(
  new URL("../../scripts/check-github-actions.mjs", import.meta.url),
);
const validSha = "0123456789abcdef0123456789abcdef01234567";
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeRepo(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "check-github-actions-"));
  tempDirs.push(dir);
  const workflows = join(dir, ".github", "workflows");
  mkdirSync(workflows, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(workflows, name), content);
  }
  return dir;
}

function runCheck(dir: string): { status: number; stderr: string } {
  const result = spawnSync(process.execPath, [SCRIPT_PATH, dir], { encoding: "utf8" });
  return { status: result.status ?? -1, stderr: result.stderr };
}

describe("check-github-actions", () => {
  it("accepts immutable external refs, local actions, and release comments", () => {
    const dir = makeRepo({
      "ci.yml": `steps:\n  - uses: actions/checkout@${validSha} # v1\n  - uses: ./.github/actions/local\n`,
    });

    expect(runCheck(dir).status).toBe(0);
  });

  it.each(["v7", "main", "0123456", `${validSha} extra`, ""])(
    "rejects mutable, short, or malformed ref %s",
    (ref) => {
      const dir = makeRepo({ "ci.yaml": `steps:\n  - uses: actions/checkout@${ref}\n` });

      const result = runCheck(dir);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(".github/workflows/ci.yaml:2:");
      expect(result.stderr).toContain(
        "external action reference must use a full 40-character commit SHA",
      );
    },
  );

  it("checks every workflow file and ignores non-workflow files", () => {
    const dir = makeRepo({
      "ci.yml": `steps:\n  - uses: actions/checkout@${validSha}\n`,
      "pages.yaml": "steps:\n  - uses: actions/setup-node@v7\n",
      "notes.txt": "uses: actions/checkout@v7\n",
    });

    const result = runCheck(dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(".github/workflows/pages.yaml:2:");
    expect(readFileSync(join(dir, ".github", "workflows", "notes.txt"), "utf8")).toContain("v7");
  });
});
