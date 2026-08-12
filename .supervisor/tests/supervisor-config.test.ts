import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const CONFIG_PATH = fileURLToPath(new URL("../config.toml", import.meta.url));
const configText = readFileSync(CONFIG_PATH, "utf8");

function stageNames(toml: string): string[] {
  const names: string[] = [];
  let section: string | null = null;
  for (const rawLine of toml.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (/^\[\[(.+)\]\]$/.test(line) || /^\[(.+)\]$/.test(line)) {
      section = line.replace(/^\[\[?|\]\]?$/g, "");
      continue;
    }
    if (section !== "stages") continue;
    const equalIndex = line.indexOf("=");
    if (equalIndex === -1) continue;
    const key = line.slice(0, equalIndex).trim();
    if (key !== "name") continue;
    names.push(
      line
        .slice(equalIndex + 1)
        .trim()
        .replaceAll('"', ""),
    );
  }
  return names;
}

function stageKind(toml: string, name: string): string | null {
  const lines = toml.split("\n");
  let inStage = false;
  let stageName: string | null = null;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (/^\[\[stages\]\]$/.test(line)) {
      inStage = true;
      stageName = null;
      continue;
    }
    if (!inStage) continue;
    if (/^\[(.+)\]$/.test(line) && !/^\[\[/.test(line)) break;
    if (!line || line.startsWith("#")) continue;
    const equalIndex = line.indexOf("=");
    if (equalIndex === -1) continue;
    const key = line.slice(0, equalIndex).trim();
    const value = line
      .slice(equalIndex + 1)
      .trim()
      .replaceAll('"', "");
    if (key === "name") {
      stageName = value;
    } else if (key === "kind" && stageName === name) {
      return value;
    }
  }
  return null;
}

const names = stageNames(configText);

describe("supervisor runtime defaults", () => {
  it("keeps concurrency conservative while retaining automatic repair", () => {
    expect(configText).toMatch(/^max_issues_per_run\s*=\s*2\s*$/m);
    expect(configText).toMatch(/^repair\s*=\s*true\s*$/m);
  });

  it("leaves base rebasing to the workers instead of a supervisor-side refresh", () => {
    expect(configText).not.toMatch(/^refresh_base\s*=\s*true\s*$/m);
  });

  it("keeps deferred scope out of automatic intake", () => {
    expect(configText).toMatch(/ignore_labels\s*=\s*\[.*"deferred"/);
    expect(configText).toMatch(/ignore_labels\s*=\s*\[.*"scope:deferred"/);
    expect(configText).toMatch(/allow_labels\s*=\s*\["ready-for-supervisor"\]/);
  });
});

describe("supervisor CI-authoritative workflow", () => {
  it("waits for required checks after PR submission", () => {
    expect(names).toEqual(["implement", "review", "submit", "ci", "publish_review"]);
    expect(stageKind(configText, "ci")).toBe("wait_for_ci");
  });

  it("declares the CI wait before the final comment stage", () => {
    expect(names.indexOf("submit")).toBeLessThan(names.indexOf("ci"));
    expect(names.indexOf("ci")).toBeLessThan(names.indexOf("publish_review"));
  });

  it("keeps auto-merge and repair enabled for the CI-authoritative gate", () => {
    expect(configText).toMatch(/^auto_merge\s*=\s*true\s*$/m);
    expect(configText).toMatch(/^ci_timeout_seconds\s*=\s*3600\s*$/m);
  });
});
