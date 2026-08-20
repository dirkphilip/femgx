import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { runCheck } from "./support/run-check";

const SCRIPT_PATH = fileURLToPath(new URL("../../scripts/check-demo-size.mjs", import.meta.url));
const tempDirs: string[] = [];

afterEach(() => {
  for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function makeRepo(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "check-demo-size-"));
  tempDirs.push(root);
  const workbench = join(root, "demo", "workbench");
  mkdirSync(workbench, { recursive: true });
  for (const [name, content] of Object.entries(files))
    writeFileSync(join(workbench, name), content);
  return root;
}

describe("check-demo-size", () => {
  it("accepts a stylesheet at the effective-line boundary", () => {
    const root = makeRepo({ "boundary.css": ".x { color: red; }\n".repeat(400) });
    expect(runCheck(SCRIPT_PATH, [root], root).status).toBe(0);
  });

  it("ignores blank lines and block comments", () => {
    const root = makeRepo({
      "comments.css": "/* ignored\ncomment */\n\n.x { color: red; }\n".repeat(400),
    });
    expect(runCheck(SCRIPT_PATH, [root], root).status).toBe(0);
  });

  it("reports every stylesheet over the limit in sorted order", () => {
    const root = makeRepo({
      "z-last.css": ".x { color: red; }\n".repeat(401),
      "a-first.css": ".x { color: red; }\n".repeat(402),
    });
    const result = runCheck(SCRIPT_PATH, [root], root);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/a-first\.css: 402[\s\S]*z-last\.css: 401/u);
  });
});
