import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const CONFIG_PATH = fileURLToPath(new URL("../../.supervisor/config.toml", import.meta.url));
const configText = readFileSync(CONFIG_PATH, "utf8");

describe("supervisor runtime defaults", () => {
  it("keeps the default run conservative and repairs explicit", () => {
    expect(configText).toMatch(/^max_issues_per_run\s*=\s*2\s*$/m);
    expect(configText).toMatch(/^repair\s*=\s*false\s*$/m);
  });
});
