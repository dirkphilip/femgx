import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const CONFIG_PATH = fileURLToPath(new URL("../../.supervisor/config.toml", import.meta.url));
const WORKFLOW_DOC_PATH = join(REPO_ROOT, "wiki/operations/supervisor-workflow.md");
const CI_AUTHORITY_DOC_PATH = join(REPO_ROOT, "wiki/operations/ci-authority.md");
const REVIEWER_PROMPT_PATH = join(REPO_ROOT, ".supervisor/prompts/reviewer.md");

type CheckState =
  | "FAILURE"
  | "ERROR"
  | "CANCELLED"
  | "TIMED_OUT"
  | "PENDING"
  | "QUEUED"
  | "IN_PROGRESS"
  | "WAITING"
  | "SUCCESS";
type Check = { state: CheckState; bucket: string };
type ChecksSummary = "passing" | "failing" | "pending" | "no_checks";
type MergeDecision = "advance" | "wait" | "block";
type BaseHealth = "green" | "red" | "unknown";
type IntakeDecision = "allow" | "pause";

const FAILURE_STATES = new Set<CheckState>(["FAILURE", "ERROR", "CANCELLED", "TIMED_OUT"]);
const PENDING_STATES = new Set<CheckState>(["PENDING", "QUEUED", "IN_PROGRESS", "WAITING"]);

function summarizeChecks(checks: readonly Check[]): ChecksSummary {
  if (checks.length === 0) return "no_checks";
  if (checks.some((check) => check.bucket === "FAIL" || FAILURE_STATES.has(check.state))) {
    return "failing";
  }
  if (checks.some((check) => check.bucket === "PENDING" || PENDING_STATES.has(check.state))) {
    return "pending";
  }
  return "passing";
}

function mergeDecision(summary: ChecksSummary): MergeDecision {
  if (summary === "passing") return "advance";
  if (summary === "pending" || summary === "no_checks") return "wait";
  return "block";
}

function intakeDecision(baseHealth: BaseHealth): IntakeDecision {
  return baseHealth === "green" ? "allow" : "pause";
}

function parseStageNames(toml: string): string[] {
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

const configText = readFileSync(CONFIG_PATH, "utf8");
const stageNames = parseStageNames(configText);

describe("CI-authoritative merge decision", () => {
  it("advances only when all required checks pass", () => {
    expect(mergeDecision(summarizeChecks([{ state: "SUCCESS", bucket: "SUCCESS" }]))).toBe(
      "advance",
    );
  });

  it("waits on pending or missing required checks", () => {
    expect(mergeDecision(summarizeChecks([{ state: "PENDING", bucket: "PENDING" }]))).toBe("wait");
    expect(mergeDecision(summarizeChecks([{ state: "QUEUED", bucket: "PENDING" }]))).toBe("wait");
    expect(mergeDecision(summarizeChecks([{ state: "IN_PROGRESS", bucket: "PENDING" }]))).toBe(
      "wait",
    );
    expect(mergeDecision(summarizeChecks([]))).toBe("wait");
  });

  it("blocks on failing required checks", () => {
    expect(mergeDecision(summarizeChecks([{ state: "FAILURE", bucket: "FAIL" }]))).toBe("block");
    expect(mergeDecision(summarizeChecks([{ state: "ERROR", bucket: "FAIL" }]))).toBe("block");
    expect(mergeDecision(summarizeChecks([{ state: "CANCELLED", bucket: "FAIL" }]))).toBe("block");
    expect(mergeDecision(summarizeChecks([{ state: "TIMED_OUT", bucket: "FAIL" }]))).toBe("block");
  });

  it("treats one failing check as failing even when others pass", () => {
    const checks: Check[] = [
      { state: "SUCCESS", bucket: "SUCCESS" },
      { state: "FAILURE", bucket: "FAIL" },
      { state: "PENDING", bucket: "PENDING" },
    ];
    expect(summarizeChecks(checks)).toBe("failing");
    expect(mergeDecision(summarizeChecks(checks))).toBe("block");
  });

  it("waits while any check is still pending even if the rest pass", () => {
    const checks: Check[] = [
      { state: "SUCCESS", bucket: "SUCCESS" },
      { state: "PENDING", bucket: "PENDING" },
    ];
    expect(summarizeChecks(checks)).toBe("pending");
    expect(mergeDecision(summarizeChecks(checks))).toBe("wait");
  });
});

describe("workflow declares the required-checks gate", () => {
  it("runs a wait_for_ci stage after submission and before the final comment", () => {
    expect(stageNames).toEqual(["implement", "review", "submit", "ci", "publish_review"]);
    expect(configText).toMatch(/name = "ci"/);
    expect(configText).toMatch(/kind = "wait_for_ci"/);
    expect(stageNames.indexOf("submit")).toBeLessThan(stageNames.indexOf("ci"));
  });

  it("keeps auto-merge and CI waiting enabled", () => {
    expect(configText).toMatch(/^auto_merge\s*=\s*true\s*$/m);
    expect(configText).toMatch(/^ci_timeout_seconds\s*=\s*3600\s*$/m);
  });

  it("documents that required CI decides mergeability, not local results", () => {
    const workflowDoc = readFileSync(WORKFLOW_DOC_PATH, "utf8");
    const reviewerPrompt = readFileSync(REVIEWER_PROMPT_PATH, "utf8");
    expect(workflowDoc).toMatch(
      /required checks[\s\S]*merge authority|merge authority[\s\S]*required checks/,
    );
    expect(reviewerPrompt).toMatch(/never report the PR merge-ready from local\s+results/);
  });
});

describe("base-health intake decision", () => {
  it("allows new feature work only on a healthy base", () => {
    expect(intakeDecision("green")).toBe("allow");
  });

  it("pauses intake on a red base", () => {
    expect(intakeDecision("red")).toBe("pause");
  });

  it("pauses conservatively when base health cannot be verified", () => {
    expect(intakeDecision("unknown")).toBe("pause");
  });

  it("keeps repair work possible while intake is paused", () => {
    const doc = readFileSync(CI_AUTHORITY_DOC_PATH, "utf8");
    expect(doc).toMatch(/repair work on the broken base remains possible/);
    expect(doc).toMatch(/repair PR restores green\s+CI/);
    expect(intakeDecision("red")).toBe("pause");
  });
});

describe("base-health intake contract", () => {
  it("documents the intake gate and its manual fallback", () => {
    const doc = readFileSync(CI_AUTHORITY_DOC_PATH, "utf8");
    expect(doc).toMatch(/base-health intake gate|base-health blocker/);
    expect(doc).toMatch(/sv pause/);
    expect(doc).toMatch(/gh api/);
  });

  it("is linked from the workflow documentation", () => {
    const workflowDoc = readFileSync(WORKFLOW_DOC_PATH, "utf8");
    expect(workflowDoc).toContain(
      "[[operations/ci-authority|CI authority and base-health intake]]",
    );
  });
});
