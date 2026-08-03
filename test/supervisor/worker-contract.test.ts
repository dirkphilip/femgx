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

const NPM_GATE_COMMANDS = [
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

describe("supervisor worker quality-gate contract", () => {
  it.each(PROMPTS)("asks agents to detect the repository's quality commands in %s", (path) => {
    const prompt = readPrompt(path);
    expect(prompt).toMatch(/quality gate is repository-aware/);
    expect(prompt).toMatch(
      /detect the repository's configured\s+quality commands before running them/,
    );
  });

  it.each(PROMPTS)(
    "keeps the npm gate authoritative for this TypeScript repository in %s",
    (path) => {
      const prompt = readPrompt(path);
      for (const command of NPM_GATE_COMMANDS) {
        expect(prompt).toContain(command);
      }
      expect(prompt).toMatch(/TypeScript\/npm repository/);
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
