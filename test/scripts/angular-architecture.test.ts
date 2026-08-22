import { dirname, join } from "node:path";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const SCRIPT_PATH = fileURLToPath(
  new URL("../../scripts/check-angular-architecture.mjs", import.meta.url),
);
const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function makeRepository(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "angular-architecture-"));
  tempRoots.push(root);
  for (const [path, source] of Object.entries(files)) {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, source);
  }
  return root;
}

function runCheck(files: Record<string, string>) {
  const root = makeRepository(files);
  return spawnSync(process.execPath, [SCRIPT_PATH, root], { encoding: "utf8" });
}

const acceptedGraph = {
  "demo/angular/src/app/app.component.ts":
    'import { ViewerComponent } from "../features/viewer/viewer.component";\n',
  "demo/angular/src/features/viewer/viewer.component.ts":
    'import { ViewerFacade } from "./viewer.facade";\n',
  "demo/angular/src/features/viewer/viewer.facade.ts":
    'import { AngularApplicationState } from "../../state/application-state";\nimport { ViewportCoordinator } from "../../effects/viewport/viewport-coordinator";\nimport { createTet4Fixture } from "fixtures/fe/tet4";\n',
  "demo/angular/src/effects/viewport/viewport-coordinator.ts":
    'import { AngularApplicationState } from "../../state/application-state";\nimport { createViewport, type Viewport } from "femgx";\n',
  "demo/angular/src/state/application-state.ts": "export const state = 1;\n",
};

describe("Angular architecture guard", () => {
  it("accepts the bounded component, facade, state, and coordinator graph", () => {
    const result = runCheck(acceptedGraph);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Angular architecture policy OK");
  });

  it("rejects source, legacy-demo, and non-coordinator package imports", () => {
    const result = runCheck({
      ...acceptedGraph,
      "demo/angular/src/features/viewer/viewer.component.ts": [
        'import { createViewport } from "femgx";',
        'import { internal } from "@/renderer/renderer-core";',
        'import { legacy } from "../../../../workbench/start";',
      ].join("\n"),
      "demo/workbench/start.ts": "export const legacy = 1;\n",
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("only the viewport coordinator may import femgx");
    expect(result.stderr).toContain("source internals");
    expect(result.stderr).toContain("legacy demo/tooling");
  });

  it("rejects outward layer edges and runtime cycles", () => {
    const result = runCheck({
      ...acceptedGraph,
      "demo/angular/src/state/application-state.ts":
        'import { ViewerFacade } from "../features/viewer/viewer.facade";\n',
      "demo/angular/src/features/viewer/viewer.facade.ts":
        'import { AngularApplicationState } from "../../state/application-state";\n',
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("state must not import outward");
    expect(result.stderr).toContain("runtime dependency cycle");
  });
});
