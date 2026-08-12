import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const CONFIG_PATH = fileURLToPath(new URL("../config.toml", import.meta.url));

function parseTomlValue(raw: string): unknown {
  const inlineComment = raw.indexOf("#");
  const valueText = (inlineComment >= 0 ? raw.slice(0, inlineComment) : raw).trim();
  if (valueText === "true") return true;
  if (valueText === "false") return false;
  if (valueText.startsWith("[") && valueText.endsWith("]")) {
    const inner = valueText.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(",").map((item) => {
      const trimmed = item.trim();
      return trimmed.startsWith('"') && trimmed.endsWith('"') ? trimmed.slice(1, -1) : trimmed;
    });
  }
  if (valueText.startsWith('"') && valueText.endsWith('"')) return valueText.slice(1, -1);
  if (/^-?\d+$/.test(valueText)) return Number(valueText);
  return valueText;
}

function parseGithubSection(toml: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  let section: string | null = null;
  for (const rawLine of toml.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const tableMatch = /^\[\[(.+)\]\]$/.exec(line);
    if (tableMatch) {
      section = `__array:${tableMatch[1] ?? ""}`;
      continue;
    }
    const sectionMatch = /^\[(.+)\]$/.exec(line);
    if (sectionMatch) {
      section = sectionMatch[1] ?? null;
      continue;
    }
    if (section !== "github") continue;
    const equalIndex = line.indexOf("=");
    if (equalIndex === -1) continue;
    const key = line.slice(0, equalIndex).trim();
    result[key] = parseTomlValue(line.slice(equalIndex + 1).trim());
  }
  return result;
}

function matchesAny(labels: readonly string[], configured: readonly string[]): boolean {
  const normalized = configured.map((label) => label.toLocaleLowerCase());
  return labels.some((label) => normalized.includes(label.toLocaleLowerCase()));
}

function isAutoPullEligible(
  labels: readonly string[],
  allowLabels: readonly string[],
  ignoreLabels: readonly string[],
): boolean {
  if (matchesAny(labels, ignoreLabels)) return false;
  if (allowLabels.length > 0 && !matchesAny(labels, allowLabels)) return false;
  return true;
}

function stringList(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

const github = parseGithubSection(readFileSync(CONFIG_PATH, "utf8"));
const allowLabels = stringList(github["allow_labels"]);
const ignoreLabels = stringList(github["ignore_labels"]);

describe("supervisor allow/ignore label configuration", () => {
  it("parses the committed [github] section", () => {
    expect(github["auto_pull"]).toBe(true);
    expect(github["supervisor_label_prefix"]).toBe("sv:");
    expect(allowLabels).toContain("ready-for-supervisor");
    expect(ignoreLabels).toContain("ignore");
  });

  it("configures allow and ignore labels as bare names, not namespaced", () => {
    expect(allowLabels).not.toContain("sv:ready-for-supervisor");
    expect(ignoreLabels).not.toContain("sv:ignore");
  });

  it("auto-pulls an unassigned issue carrying the configured allow label", () => {
    expect(isAutoPullEligible(["ready-for-supervisor"], allowLabels, ignoreLabels)).toBe(true);
    expect(isAutoPullEligible(["ready-for-supervisor", "other"], allowLabels, ignoreLabels)).toBe(
      true,
    );
  });

  it("keeps ignore-label precedence over allow labels", () => {
    expect(isAutoPullEligible(["ignore"], allowLabels, ignoreLabels)).toBe(false);
    expect(isAutoPullEligible(["ignore", "ready-for-supervisor"], allowLabels, ignoreLabels)).toBe(
      false,
    );
  });

  it("matches fully qualified labels literally", () => {
    expect(isAutoPullEligible(["team:ready"], ["team:ready"], [])).toBe(true);
    expect(isAutoPullEligible(["team:ready"], ["team:ready"], ["ignore"])).toBe(true);
    expect(isAutoPullEligible(["team:skip"], [], ["team:skip"])).toBe(false);
  });

  it("treats namespaced labels as distinct from configured bare labels", () => {
    expect(isAutoPullEligible(["sv:ready-for-supervisor"], allowLabels, ignoreLabels)).toBe(false);
    expect(isAutoPullEligible(["sv:ignore"], allowLabels, ignoreLabels)).toBe(false);
  });
});
