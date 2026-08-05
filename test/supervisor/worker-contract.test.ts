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

  it("gives the reviewer worker-owned base rebasing without a supervisor checkpoint", () => {
    const prompt = readPrompt(".supervisor/prompts/reviewer.md");
    expect(prompt).toMatch(/Fetch `origin\/\$base_branch` and rebase onto/);
    expect(prompt).toMatch(/run a final safety-net rebase before submission/);
    expect(prompt).not.toContain("$base_freshness");
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

const PRODUCT_CONTRACT_PROMPTS = PROMPTS.filter((path) => /implementer|reviewer/.test(path));

describe("supervisor requirement-challenge contract", () => {
  it.each(PRODUCT_CONTRACT_PROMPTS)("opens %s with the requirement challenge", (path) => {
    const prompt = readPrompt(path);
    expect(prompt).toMatch(/user value/i);
    expect(prompt).toMatch(/minimum behavior/i);
    expect(prompt).toMatch(/deletion candidates/i);
    expect(prompt).toMatch(/non-goals/i);
    expect(prompt).toMatch(/new abstraction/i);
    expect(prompt).toMatch(/product scope|product-scope/);
  });

  it.each(PROMPTS)("flags out-of-contract additions in %s", (path) => {
    const prompt = readPrompt(path);
    expect(prompt).toMatch(/fallback branches/i);
    expect(prompt).toMatch(/compatibility layers/i);
    expect(prompt).toMatch(/optional modes/i);
    expect(prompt).toMatch(/public API/i);
  });

  it.each(PRODUCT_CONTRACT_PROMPTS)("expects deletion-first implementations in %s", (path) => {
    const prompt = readPrompt(path);
    expect(prompt).toMatch(/may delete code/);
    expect(prompt).toMatch(/should not grow without\s+justification/);
  });

  it("gives the reviewer a lightweight scope checklist", () => {
    const prompt = readPrompt(".supervisor/prompts/reviewer.md");
    expect(prompt).toMatch(/scope checklist/);
    expect(prompt).toMatch(/Line count, module count, or abstraction count grew/);
  });
});

describe("product contract", () => {
  it("AGENTS.md encodes the focused agent contract", () => {
    const agents = readFileSync(join(REPO_ROOT, "AGENTS.md"), "utf8");
    expect(agents).toMatch(/## Product Contract/);
    expect(agents).toMatch(/### Core requirements/);
    expect(agents).toMatch(/### Non-goals and deferred capabilities/);
    expect(agents).toMatch(/### Simplicity rules/);
    expect(agents).toMatch(/### Decision gate for proposed additions/);
    expect(agents).toMatch(/requirements\/product-scope/);
  });

  it("wiki/requirements/product-scope.md is the source-of-truth scope contract", () => {
    const scope = readFileSync(join(REPO_ROOT, "wiki/requirements/product-scope.md"), "utf8");
    expect(scope).toMatch(/source of truth for product scope/);
    expect(scope).toMatch(/Core now/);
    expect(scope).toMatch(/Deferred/);
    expect(scope).toMatch(/Remove/);
    expect(scope).toMatch(/line counts/i);
    expect(scope).toMatch(/Decision gate/);
  });
});
