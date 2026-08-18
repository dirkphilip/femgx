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
  it("accepts explicit package entry imports", () => {
    const root = makeDemo({
      "ordinary.ts": 'import { createScene } from "../src/entries/root";\n',
      "glb.ts": 'import { importGlb } from "../src/entries/io/glb";\n',
    });
    expect(runCheck(root).status).toBe(0);
  });

  it("rejects deep internal imports outside benchmark exemptions", () => {
    const root = makeDemo({
      "ordinary.ts": 'import { createInteractionState } from "../src/interaction/interaction";\n',
    });
    const result = runCheck(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("unauthorized deep demo import ../src/interaction/interaction");
  });

  it("retains only the narrow internal selection-query exception", () => {
    const root = makeDemo({
      "ordinary.ts":
        'import { selectedTargetCount } from "../src/interaction/selection-queries";\n',
    });
    expect(runCheck(root).status).toBe(0);
  });

  it("rejects deep imports from ordinary demo code", () => {
    const root = makeDemo({ "ordinary.ts": 'import { createScene } from "../src/scene/scene";\n' });
    const result = runCheck(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("unauthorized deep demo import ../src/scene/scene");
  });

  it("rejects deep imports from ordinary Svelte components", () => {
    const root = makeDemo({
      "workbench/WorkbenchShell.svelte":
        '<script lang="ts">\nimport { createScene } from "../../src/scene/scene";\n</script>\n',
    });
    const result = runCheck(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("unauthorized deep demo import ../../src/scene/scene");
  });

  it("keeps the named benchmark exemptions narrow", () => {
    const retainedExemptions = [
      "demo/benchmark/interactive.ts",
      "demo/benchmark/measurement.ts",
      "demo/benchmark/node-selection.ts",
      "demo/benchmark/selection.ts",
      "demo/benchmark/structured-fe.ts",
      "demo/benchmark/tet4-transfer.ts",
      "demo/benchmark/packed-tet4.ts",
      "demo/benchmark/memory.ts",
      "demo/benchmark/model.ts",
      "demo/benchmark/transfer.ts",
      "demo/fixtures/performance-fixture.ts",
    ];
    const script = readFileSync(SCRIPT_PATH, "utf8");
    const exemptionBlock = script.match(
      /const benchmarkExemptions = new Set\(\[([\s\S]*?)\]\);/u,
    )?.[1];
    expect(exemptionBlock).toBe(retainedExemptions.map((path) => `\n  "${path}",`).join("") + "\n");
    expect(script).not.toContain('"demo/benchmark/runner.ts"');

    const root = makeDemo({
      "benchmark/interactive.ts": 'import { orbitCamera } from "../src/interaction/interaction";\n',
      "benchmark/measurement.ts":
        'import { createRenderer } from "../src/renderer/gpu-renderer";\n',
      "benchmark/node-selection.ts":
        'import { createRenderer } from "../src/renderer/gpu-renderer";\n',
      "benchmark/selection.ts": 'import { createRenderer } from "../src/renderer/gpu-renderer";\n',
      "benchmark/structured-fe.ts": 'import { createElement } from "../src/elements/element";\n',
      "benchmark/memory.ts": 'import { createRenderer } from "../src/renderer/gpu-renderer";\n',
      "benchmark/model.ts": 'import { createPart } from "../src/geometry/part";\n',
      "fixtures/performance-fixture.ts": 'import { createPart } from "../../src/geometry/part";\n',
    });
    const result = runCheck(root);
    expect(result.status).toBe(0);

    const runnerRoot = makeDemo({
      "benchmark/runner.ts": 'import { createScene } from "../src/scene/scene";\n',
    });
    expect(runCheck(runnerRoot).status).toBe(1);
  });
});
