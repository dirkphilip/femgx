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

## Pull request mode and merge behavior

The shared configuration sets `github.draft = false`, so Supervisor creates
regular pull requests ready for review. The current Supervisor implementation
does not provide an `auto_merge` setting or merge stage: after publication it
tracks the job as `awaiting_merge` and leaves the final merge to the operator.
GitHub auto-merge can be requested separately with `gh pr merge --auto`, but
Supervisor does not request or manage that mode itself.

## Approval allow-list

`github.auto_pull = true` with `github.allow_labels = ["ready-for-supervisor"]`
gates automatic intake: only issues carrying that label are auto-pulled. The
label is added only by the repo owner or a trusted agent, so random or
agent-filed issues never get pulled in without explicit approval. Approve an
issue by adding the label:

```sh
gh issue edit 123 --add-label ready-for-supervisor
```

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
