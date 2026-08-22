import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const script = fileURLToPath(new URL("../../scripts/check-fixture-boundary.mjs", import.meta.url));

function runFixtureBoundary(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), "check-fixture-boundary-"));
  for (const [path, source] of Object.entries(files)) {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, source);
  }
  return spawnSync(process.execPath, [script, root], { encoding: "utf8" });
}

describe("check-fixture-boundary", () => {
  it("accepts public package imports and fixture-local helpers", () => {
    const result = runFixtureBoundary({
      "fixtures/fe/tet4.ts": 'import { createSceneBuilder } from "femgx";\n',
      "fixtures/fe/support.ts": "export const value = 1;\n",
      "src/index.ts": "export {};\n",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Fixture import boundary OK");
  });

  it("rejects application, test, and source-internal imports", () => {
    const result = runFixtureBoundary({
      "fixtures/fe/tet4.mjs":
        'export { createSceneBuilder } from "../../demo/workbench/models/model";\n',
      "src/scene/scene.mjs": 'export { value } from "../../fixtures/fe/support";\n',
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("unauthorized fixture import");
    expect(result.stderr).toContain("library source cannot import repository fixtures");
  });

  it("rejects every supported TypeScript re-export form", () => {
    const result = runFixtureBoundary({
      "fixtures/fe/reexports.mts": [
        'export * as demoNamespace from "../../demo/workbench/models/model";',
        'export type * from "../../demo/workbench/models/model";',
        'export type * as demoTypes from "../../demo/workbench/models/model";',
        'export type { createSceneBuilder } from "../../demo/workbench/models/model";',
      ].join("\n"),
      "src/scene/scene.ts": 'export type { value } from "../../fixtures/fe/support";\n',
    });

    expect(result.status).toBe(1);
    expect(result.stderr.match(/unauthorized fixture import/g)).toHaveLength(4);
    expect(result.stderr).toContain("library source cannot import repository fixtures");
  });
});
