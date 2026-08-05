import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

const PROMPTS = [
  ".supervisor/prompts/implementer.md",
  ".supervisor/prompts/reviewer.md",
  ".supervisor/prompts/pr-repair.md",
];

const FULL_NPM_GATE_COMMANDS = [
  "npm run format",
  "npm run lint",
  "npm run typecheck",
  "npm run test:coverage",
  "npm run build",
  "npm run test:e2e",
];

function readPrompt(path: string): string {
  return readFileSync(join(REPO_ROOT, path), "utf8");
}

function blocks(content: string): string[] {
  return content
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0);
}

function hasStandaloneCommand(content: string, command: string): boolean {
  return content.split("\n").some((line) => {
    const trimmed = line.trim();
    return trimmed === command || trimmed === `\`${command}\``;
  });
}

describe("supervisor worker quality-gate contract", () => {
  it.each(PROMPTS)("asks agents to detect the repository's quality commands in %s", (path) => {
    const prompt = readPrompt(path);
    expect(prompt).toMatch(/quality gate is repository-aware/);
    expect(prompt).toMatch(
      /detect the repository's configured\s+quality commands before running them/,
    );
  });

  it.each(PROMPTS)("keeps the full npm gate out of %s", (path) => {
    const prompt = readPrompt(path);
    for (const command of FULL_NPM_GATE_COMMANDS) {
      expect(hasStandaloneCommand(prompt, command)).toBe(false);
    }
    expect(prompt).toMatch(/focused checks/);
    expect(prompt).toContain("Do not invoke the `quality-gate`");
  });

  it.each(PROMPTS)("runs %s workers' focused checks once instead of repeatedly", (path) => {
    const prompt = readPrompt(path);
    expect(prompt).toMatch(/focused checks/);
    expect(prompt).toMatch(/\bonce\b/);
    expect(prompt).toMatch(/loop on validation/i);
  });

  it.each(PROMPTS)("does not ask %s workers to run the pre-commit gate by hand", (path) => {
    const prompt = readPrompt(path);
    expect(prompt).not.toMatch(/pre-commit gate at most once/);
    expect(prompt).toMatch(/pre-commit hooks run automatically on every commit/);
  });

  it.each(PROMPTS)("keeps the full e2e suite and build out of %s", (path) => {
    const prompt = readPrompt(path);
    expect(prompt).toMatch(/Do not run coverage, the full e2e suite, or the full build/);
  });

  it("records focused local validation in the reviewer without making it a merge authority", () => {
    const prompt = readPrompt(".supervisor/prompts/reviewer.md");
    expect(prompt).toMatch(/focused local/);
    expect(prompt).toMatch(/not a merge authority/);
    expect(prompt).toMatch(/required checks decide mergeability|required checks/);
    expect(prompt).toMatch(
      /Do not run the full\s+product gate|Do not run\s+the\s+full\s+product gate/,
    );
    expect(prompt).toMatch(/never report the PR merge-ready from local\s+results/);
  });

  it.each(PROMPTS)(
    "requires the validated base SHA and a local-vs-CI distinction in %s",
    (path) => {
      const prompt = readPrompt(path);
      expect(prompt).toMatch(/validated base SHA/);
      expect(prompt).toMatch(/distinguishing local checks from/);
      expect(prompt).toMatch(/Do not add keys to the handoff JSON/);
    },
  );

  it.each(PROMPTS)("scopes uv/pytest commands to Python repositories in %s", (path) => {
    for (const block of blocks(readPrompt(path))) {
      if (block.includes("uv run") || block.includes("pytest")) {
        expect(block).toMatch(/Python\/uv/);
      }
    }
  });

  it("preserves the handoff and progress contract in every prompt", () => {
    for (const path of PROMPTS) {
      const prompt = readPrompt(path);
      expect(prompt).toContain("$handoff_contract");
      expect(prompt).toContain("$handoff_feedback_path");
      expect(prompt).toContain("$handoff_path");
      expect(prompt).toContain("$progress_path");
    }
  });
});
