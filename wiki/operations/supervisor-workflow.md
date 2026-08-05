# Supervisor workflow

Local issue-to-pull-request workflow driven by Agent Supervisor (`sv`).

## Always launch with uvx

Never invoke `sv` from the agent-supervisor venv directly. Always launch it
through `uvx` so the tool resolves its own environment:

```sh
uvx --from /Users/dirkphilip/workspace/agent-supervisor sv run 123
```

For interactive use, alias it:

```sh
alias sv='uvx --from /Users/dirkphilip/workspace/agent-supervisor sv'
```

### Why

- No dependency on the local venv; `uvx` builds and runs the tool in its own
  isolated environment.
- `agent-supervisor` is not published to PyPI, so the checkout path is required:
  `uvx --from agent-supervisor` fails to resolve, and the standalone wheel in
  `dist/` is unusable because its `sv-models` dependency is unpublished.

## Provider

The supervisor runs agents with the `opencode` provider
(`.supervisor/config.toml`, overridable per machine in
`.supervisor/config.local.toml`), using model `opencode-go/deepseek-v4-flash`.
`opencode` must be installed and authenticated before a run.

## Useful commands

```sh
sv run 123            # pull (if needed) and run one issue
sv run                # process up to max_issues_per_run
sv run --detach       # keep the workflow running in the background
sv status             # stopped / running / pausing
sv job status --json  # per-job state (prefer --json for scripts/agents)
sv stop               # interrupt workers and stop immediately
```

## Notes

- See `.supervisor/SKILL.md` for the full command reference and agent operating
  rules.
- Keep `.supervisor/config.local.toml`, `.supervisor/issues.json`, and
  `.supervisor/run/` local and ignored.
- The shared defaults use two concurrent issue slots while retaining automatic
  PR repair. The lower cap limits token and resource contention when a repair
  pass runs beside active work; local overrides should only raise concurrency
  for independent tasks with sufficient machine capacity. Use `sv job repair
ISSUE` for a deliberate manual pass.

## Repository-aware validation

The worker prompts (`prompts/implementer.md`, `prompts/reviewer.md`,
`prompts/pr-repair.md`) detect the repository's configured commands by reading
`AGENTS.md`, the package-manager manifest (`package.json` for npm,
`pyproject.toml` + `uv.lock` for Python/uv), and the CI workflow config.

Validation is stage-specific so implementation time is not spent repeating the
same expensive gate before the code is ready for review:

- Implement and repair workers run one focused batch of formatting, lint,
  typecheck, and relevant test checks once, before handoff. They do not run
  checks after every edit, do not loop on validation, and do not run coverage,
  the full build, or the full e2e suite. Installed pre-commit hooks run
  automatically on every commit, so workers do not invoke them by hand.
- The reviewer runs the full repository gate once before submission.
- CI remains authoritative for the published PR.

- Python/uv repositories keep the generic gate: `uv run pre-commit run --all-files`
  before implement/repair handoff, plus `uv run pytest --cov=sv --cov-branch
--cov-report=term-missing` during review.
- TypeScript/npm reviewers (like femgx) use the npm gate: `npm run format`,
  `npm run lint`, `npm run typecheck`, `npm run test:coverage`, `npm run build`,
  and `npm run test:e2e`. This mirrors `.github/workflows/ci.yml`.

`test/supervisor/worker-contract.test.ts` locks this behavior: prompts must be
repository-aware, keep the full npm gate in review, keep it out of
implementation/repair, scope uv/pytest commands to Python repositories, and
preserve the handoff/progress contract.

## Pull request mode and merge behavior

The shared configuration sets `github.draft = false`, so Supervisor creates
regular pull requests ready for review. The current configuration also sets
`github.auto_merge = true`, so after publication Supervisor asks GitHub to
merge the PR automatically once required checks and approvals are satisfied.
The PR remains a regular, reviewable PR rather than a draft.

## Approval allow-list

`github.auto_pull = true` with `github.allow_labels = ["ready-for-supervisor"]`
gates automatic intake: only issues carrying that label are auto-pulled. The
label is added only by the repo owner or a trusted agent, so random or
agent-filed issues never get pulled in without explicit approval. Approve an
issue by adding the label:

```sh
gh issue edit 123 --add-label ready-for-supervisor
```

Configured `allow_labels` and `ignore_labels` are matched exactly as written;
the supervisor does not apply its namespace prefix to them. A bare label such as
`ready-for-supervisor` matches the GitHub label `ready-for-supervisor`, and a
fully qualified label such as `team:ready` matches that exact label.
`ignore_labels` still take precedence, so an issue carrying an ignore label is
never auto-pulled even when it also carries an allow label. See
[[operations/supervisor-label-matching|Supervisor label matching]] for the effective
configuration and the migration behavior.

Explicit `sv run <issue>` bypasses the auto-pull gate.

## Auto-filed improvement issues

The implementer and reviewer prompts (`prompts/implementer.md`,
`prompts/reviewer.md`) instruct agents to file a concise GitHub issue as a work
item whenever they notice something that would materially improve the
codebase's maintainability, quality, or cleanliness — including larger
refactors. Agents check for duplicates first, keep issues focused and
actionable (no trivial nits or pure style), and mention the issue URL in the
handoff summary. Because auto-pull requires the `ready-for-supervisor` label,
such agent-filed issues are NOT pulled in automatically — approve them
explicitly by adding the label.

Known gap: the OpenCode provider's permission rules currently deny every `gh`
command, so agents cannot actually file those issues yet. Tracked upstream at
dirkphilip/sv#245.

## Local sandbox note

In restricted desktop runs, `uvx` may fail before Supervisor starts if its
default cache/tool directories are outside the writable workspace, and GitHub
commands may fail when the local token is expired or network access is blocked.
Try task-local `UV_CACHE_DIR` and `UV_TOOL_DIR` first. If package downloads are
offline, use the existing local Supervisor checkout only for safe status checks;
do not edit Supervisor runtime state by hand.

## Pre-commit gate

Python/uv repositories keep the generic gate `uv run pre-commit run
--all-files` before implement/repair handoff. This repo is TypeScript/npm:
husky owns the git `pre-commit` hook slot locally and runs lint-staged
(`npm run pre-commit`) automatically on every commit — ESLint with `--fix`,
Prettier, and a merge-conflict marker check on staged files.
`.pre-commit-config.yaml` (see [[engineering/pre-commit-hooks|Pre-commit
hooks]]) adds framework validators that CI runs via `pre-commit run
--all-files`. Implementation and repair workers therefore run one focused batch
of checks on their changed files before handoff and never invoke the pre-commit
gate by hand; CI runs the full quality gate after a PR exists.
