import { dirname, join } from "node:path";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { runCheck } from "./support/run-check";

const SCRIPT_PATH = fileURLToPath(
  new URL("../../scripts/check-demo-workbench-architecture.mjs", import.meta.url),
);
const tempDirs: string[] = [];

afterEach(() => {
  for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function makeRepo(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "check-demo-workbench-architecture-"));
  tempDirs.push(root);
  for (const [name, source] of Object.entries(files)) {
    const path = join(root, "demo", "workbench", name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, source);
  }
  return root;
}

describe("check-demo-workbench-architecture", () => {
  it("accepts the one-way presentation and composition boundaries", () => {
    const root = makeRepo({
      "presentation/snapshot.ts": "export interface WorkbenchPresentationPort {}\n",
      "state/model-state.ts": "export const state = {};\n",
      "controllers/controller.ts": 'import "../state/model-state";\n',
      "start.ts": 'import "./controllers/controller";\n',
      "ui/WorkbenchApp.svelte":
        '<script lang="ts">import type { WorkbenchPresentationPort } from "../presentation/snapshot";</script>\n',
    });
    expect(runCheck(SCRIPT_PATH, [root], root).status).toBe(0);
  });

  it("rejects direct UI imports of controller internals", () => {
    const root = makeRepo({
      "controllers/controller.ts": "export {};\n",
      "ui/WorkbenchApp.svelte":
        '<script lang="ts">import type { WorkbenchController } from "../controllers/controller";</script>\n',
    });
    const result = runCheck(SCRIPT_PATH, [root], root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("UI must depend on the presentation port");
  });

  it("finds multiline type imports, re-exports, side-effect imports, and dynamic imports", () => {
    const root = makeRepo({
      "controllers/controller.ts": "export {};\n",
      "ui/WorkbenchApp.svelte": `<script lang="ts">
  import type {
    WorkbenchController,
  } from "../controllers/controller";
</script>
`,
      "state/re-export.ts": 'export { WorkbenchController } from "../controllers/controller";\n',
      "interaction/side-effect.ts": 'import "../controllers/controller";\n',
      "models/dynamic.ts": 'void import("../controllers/controller");\n',
    });
    const result = runCheck(SCRIPT_PATH, [root], root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("UI must depend on the presentation port");
    expect(result.stderr.match(/only the workbench composition root/g)?.length).toBe(4);
  });

  it("rejects controller dependencies outside the composition root", () => {
    const root = makeRepo({
      "controllers/controller.ts": "export {};\n",
      "interaction/commands.ts": 'import "../controllers/controller";\n',
    });
    const result = runCheck(SCRIPT_PATH, [root], root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "only the workbench composition root may depend on controllers",
    );
  });

  it("rejects implementation dependencies on Svelte UI", () => {
    const root = makeRepo({
      "ui/WorkbenchApp.svelte": "<main></main>\n",
      "state/presentation.ts": 'import "../ui/WorkbenchApp.svelte";\n',
    });
    const result = runCheck(SCRIPT_PATH, [root], root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("implementation must not depend on Svelte UI");
  });
});
