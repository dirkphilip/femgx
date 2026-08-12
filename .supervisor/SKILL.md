---
name: agent-supervisor
description: Run and control Agent Supervisor, the local issue-to-pull-request workflow. Use this skill when initializing a repository, queueing or running issues, monitoring jobs, controlling active work, or helping an agent work within a Supervisor-managed worktree.
---

# Agent Supervisor

For repository contracts and the quality gate, follow `../AGENTS.md` and
`../wiki/engineering/quality-gate.md`. GitHub issues and pull requests remain
the authoritative work tracker.

Use Agent Supervisor to turn an approved GitHub issue into a pull request
through an isolated, resumable coding-agent workflow.

## Initialize a repository

Run these commands from the repository that should be supervised:

```sh
gh auth login
sv init --provider codex --github-username YOUR_GITHUB_LOGIN
# Or use OpenCode:
# sv init --provider opencode --github-username YOUR_GITHUB_LOGIN
```

Choose `cursor`, `copilot`, or `opencode` when using a different supported
coding-agent CLI. For OpenCode, install it with
`curl -fsSL https://opencode.ai/install | bash`, then authenticate with
`opencode auth login` (or run the TUI and use `/connect`) before starting a
run. Review the generated
`.supervisor/config.toml` and commit the shared workflow files. Keep
`.supervisor/config.local.toml`, `.supervisor/issues.json`, and
`.supervisor/run/` local and ignored.

OpenCode model overrides use its `provider/model` form, such as
`openai/gpt-5.2`; use `opencode models` to see the models available to the
authenticated provider. OpenCode runs with automatic permission approval for
headless work, while the adapter denies `git push` and `gh` commands and the
worker prompt and supervisor retain responsibility for local Git versus
publication actions.

If the repository was initialized previously, use `sv update` to add
missing bundled files without replacing configuration, queued issues, or
runtime state.

## Queue and run work

Run one approved open GitHub issue directly; `sv run` pulls it into the local
queue when needed:

```sh
sv run 123
```

New setups default to manual intake: `sv run` does not automatically queue open
GitHub issues. Use an explicit `sv run ISSUE`, or set `github.auto_pull = true`
and configure `github.allow_labels` with an approval label such as
`["ready-for-supervisor"]`. When auto-pull is enabled, it queues unassigned
open issues, including mid-run whenever active jobs fall below
`runner.max_issues_per_run`; `github.ignore_labels` still takes precedence, and
explicit `sv run ISSUE` is unaffected.

Useful queue and run variants:

```sh
sv run 123                       # pull (if needed), run, or queue into a live supervisor
sv run 123 --force               # pull even when the issue has an ignored label
sv run                           # process up to max_issues_per_run
sv run --once                    # process one issue without watching for more
sv run --detach                  # keep the workflow running in the background
sv clean                         # wipe runtime state, worktrees, and issues.json
sv clean --force                 # also remove protected open-issue jobs
sv pause                         # stop new intake; exit when agents finish and PRs are clean
sv continue                      # cancel pause and resume intake on the live run
sv status                        # show whether the supervisor is stopped, running, or pausing
sv stop                          # interrupt workers and stop the run process immediately
```

Use `sv job repair N` when an existing open PR needs a one-shot pass to become
mergeable: base conflicts, failing checks, or sensible review comments.

## Observe a run

`sv run` starts a local-only API and prints its URL. Keep the API on
loopback and never share the runtime control token. There is no standalone
API-only command; use a long-lived `run` (default watch, or `--detach`) when
the control plane must stay up. For a detached run, query the active API from
the CLI:

```sh
sv status --json
sv job status --verbose
sv job status --json
sv job inspect 123 --json
sv job logs 123 --stage implement --follow
sv job sync 123
sv pause
sv continue
sv stop
```

Use `job sync` to refresh recorded PR status without starting repair, and
`job repair N` to start a one-shot repair pass that injects current PR comments
and aims to make the PR mergeable. Prefer `--json` on `job` commands for
scripts and agents. A job waits for required CI checks after its PR is created
and remains in `awaiting_merge` until the PR is merged. Use `sv pause` to drain
a live run without interrupting agents, `sv continue` to cancel that pause and
resume intake, or `sv stop` for an immediate verified shutdown of the run
process.

GitHub's required checks decide mergeability: the workflow waits for them
(`wait_for_ci`) and a pending, missing, or failing required check blocks
completion. Failing required checks may trigger PR repair (`github.repair`).
New feature intake pauses while the base commit's CI is red; see
`wiki/operations/ci-authority.md`.

## Validate automation contracts

Run the focused automation checks from the repository root:

```sh
node .supervisor/check-boundary.mjs
```

Configured workflows may use `when_labels` to skip optional stages and
`deny_labels` to skip a stage when a label is present. They may also use
`wait_for_labels` with `allow_labels`/`deny_labels` for human approval. Approval
waits appear as `awaiting_approval`, retain a capacity slot, and resume when an
allow label appears; denied or closed issues become terminal.

## Report critical issues

When you encounter a critical issue that requires maintainer attention, check
for an existing duplicate and file a concise GitHub issue. Use a short,
specific title and include only the impact, essential evidence or reproduction,
and the recommended next action. Never include secrets, credentials, or
Supervisor control tokens.

## Control active and terminal jobs

Control only the requested issue, and check its status before taking a lifecycle
action:

```sh
sv job pause 123
sv job resume 123
sv job stop 123
sv job retry 123
sv job delete 123
sv job repair 123
```

Pause and resume apply to the recorded process group. Retry requeues terminal
or stopped work. Delete removes local terminal state, logs, and the managed
worktree; it does not delete the GitHub issue, pull request, or branch.

For automation, add `--json` to the same commands:

```sh
sv job status --json
sv job pause 123 --json
sv job resume 123 --json
sv job stop 123 --json
sv job retry 123 --json
sv job delete 123 --json
sv job sync 123 --json
sv job repair 123 --json
```

## Agent operating rules

When working as a coding agent inside a Supervisor-managed worktree:

1. Read the complete worker specification under
   `.supervisor/run/jobs/<N>/stages/<stage>/<NNN>/worker.md` (path named
   by the launch prompt); it is the authoritative contract for the current role.
2. Edit only the assigned worktree. Add focused tests when behavior changes.
   The quality gate is repository-aware: detect the repository's configured
   quality commands before running them (`AGENTS.md`, package-manager
   manifest, CI workflows). Implementation, review, and repair workers run
   focused checks once, before handoff, and never loop on validation; installed
   pre-commit hooks run automatically on commit, so they are not invoked by
   hand. The full product gate is owned by CI, and the reviewer records local
   validation without acting as a second merge authority. Own local
   Git in the worktree
   (fetch, rebase onto the base branch, commit).
3. Do not push, call `gh`, create pull requests, start another agent, rewrite
   the base branch, change remotes, or change secrets and deployments.
4. Record concise restart-safe progress in the paths named by `worker.md`.
5. Write the required handoff JSON before finishing.

The supervisor owns process management, worktrees, pushes, GitHub claims, pull
requests, checks, and PR status synchronization. It may still run a final
safety-net rebase before publication. Do not edit runtime state by hand to
control a job; use the CLI or API.
