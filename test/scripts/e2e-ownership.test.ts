import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "../..");
const e2e = join(root, "e2e");

function filesUnder(directory: string, suffix: string): string[] {
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(suffix))
    .map((entry) => join(entry.parentPath, entry.name));
}

describe("browser suite ownership", () => {
  it("keeps every browser spec in exactly one owner root", () => {
    const specs = filesUnder(e2e, ".spec.ts");
    expect(
      specs.every(
        (file) => file.startsWith(join(e2e, "core")) || file.startsWith(join(e2e, "demo")),
      ),
    ).toBe(true);
    expect(filesUnder(join(e2e, "core"), ".spec.ts")).toEqual([
      join(e2e, "core/core-foundation.spec.ts"),
      join(e2e, "core/core-journeys.spec.ts"),
    ]);
    expect(existsSync(join(e2e, "demo/demo-lifecycle.spec.ts"))).toBe(true);
    expect(existsSync(join(e2e, "demo/demo-import.spec.ts"))).toBe(true);
    expect(existsSync(join(e2e, "demo/smoke.spec.ts"))).toBe(true);
    expect(specs).not.toContain(join(e2e, "demo.spec.ts"));
  });

  it("keeps core and browser-support sources independent from the workbench owner", () => {
    const coreSources = filesUnder(join(e2e, "core"), ".ts").map((file) =>
      readFileSync(file, "utf8"),
    );
    const browserSupportSources = filesUnder(join(e2e, "browser-support"), ".ts").map((file) =>
      readFileSync(file, "utf8"),
    );
    expect(coreSources.join("\n")).not.toMatch(/demo\//);
    expect(coreSources.join("\n")).not.toContain('data-testid="view-canvas"');
    expect(browserSupportSources.join("\n")).not.toMatch(/(?:core|demo)\//);
    expect(readFileSync(join(e2e, "core/core-host.ts"), "utf8")).toContain(
      'from "../../src/index"',
    );
  });

  it("keeps the fast lane exclude-based and browser-free", () => {
    const packageJson = readFileSync(join(root, "package.json"), "utf8");
    const fastLane = packageJson.match(/"test:core": "([^"]+)"/)?.[1] ?? "";
    expect(fastLane).toContain("vitest run");
    for (const excludedSuite of [
      "test/demo/**",
      "test/renderer/**",
      "test/viewport/**",
      "test/platform/**",
    ]) {
      expect(fastLane).toContain(excludedSuite);
    }
    expect(fastLane).not.toContain("playwright");
  });

  it("exposes separate core, demo, serialized hardware, software, performance, and no-GPU commands", () => {
    const packageJson = readFileSync(join(root, "package.json"), "utf8");
    for (const script of [
      "test:e2e:core",
      "test:e2e:demo",
      "test:e2e:combined",
      "test:e2e:layout",
      "test:e2e:software",
      "test:e2e:performance",
      "test:e2e:no-gpu",
    ]) {
      expect(packageJson).toContain(`"${script}"`);
    }
    expect(packageJson).toContain("e2e/core/core-foundation.spec.ts");
    expect(packageJson).toContain("e2e/demo/demo-layout.spec.ts");
    expect(packageJson).not.toContain("e2e/webgpu-lifecycle.spec.ts");
  });

  it("never reuses a dev server from another worktree", () => {
    const config = readFileSync(join(root, "playwright.config.ts"), "utf8");
    expect(config).toContain("reuseExistingServer: false");
    expect(config).toContain('name: "chrome-unsupported"');
    expect(config).toContain("core-foundation\\.spec");
  });
});
