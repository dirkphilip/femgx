import { dirname, join } from "node:path";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const SCRIPT_PATH = fileURLToPath(
  new URL("../../scripts/check-demo-import-boundary.mjs", import.meta.url),
);
const tempDirs: string[] = [];

afterEach(() => {
  for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function makeDemo(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "check-demo-import-boundary-"));
  tempDirs.push(root);
  const demo = join(root, "demo");
  mkdirSync(demo, { recursive: true });
  for (const [name, source] of Object.entries(files)) {
    const path = join(demo, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, source);
  }
  return root;
}

function runCheck(root: string): { readonly status: number; readonly stderr: string } {
  const result = spawnSync(process.execPath, [SCRIPT_PATH, root], {
    cwd: root,
    encoding: "utf8",
  });
  return { status: result.status ?? -1, stderr: result.stderr };
}

describe("check-demo-import-boundary", () => {
  it("accepts public root imports", () => {
    const root = makeDemo({ "ordinary.ts": 'import { createScene } from "../src/index";\n' });
    expect(runCheck(root).status).toBe(0);
  });

  it("rejects deep imports from ordinary demo code", () => {
    const root = makeDemo({ "ordinary.ts": 'import { createScene } from "../src/scene/scene";\n' });
    const result = runCheck(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("unauthorized deep demo import ../src/scene/scene");
  });

  it("keeps the named benchmark exemptions narrow", () => {
    const root = makeDemo({
      "benchmark/runner.ts": 'import { createScene } from "../src/scene/scene";\n',
      "benchmark/model.ts": 'import { createPart } from "../src/geometry/part";\n',
      "fixture/performance-fixture.ts": 'import { createPart } from "../../src/geometry/part";\n',
    });
    const result = runCheck(root);
    expect(result.status).toBe(0);
    expect(readFileSync(join(root, "demo", "benchmark", "runner.ts"), "utf8")).toContain(
      "src/scene",
    );
  });
});
