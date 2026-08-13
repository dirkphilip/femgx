# Worker messaging protocol

The supervisor generates a worker file for every role invocation under
`.supervisor/run/jobs/<N>/stages/<stage>/<NNN>/worker.md`. It starts the
coding agent with a short prompt that points to that file; the worker file is
the authoritative contract.

## Requirement challenge and deletion-first

Every worker starts by challenging the requested scope against `AGENTS.md` and
`wiki/requirements/product-scope.md` (the authoritative scope contract): user
value, minimum behavior, deletion candidates, non-goals, and whether a new
abstraction is truly necessary. Workers reject or flag scope expansion that is
not in the issue, do not add fallback branches, compatibility layers, optional
modes, or public API surface without an explicit requirement, and treat
deletion-first as the default: a successful implementation may delete code, and
line count, module count, and abstraction count should not grow without
justification.

## Issue intake and publication

Workers do not create or modify GitHub issues or pull requests. Fold small,
clearly related fixes into the current task when they are safe and bounded; do
not propose a separate issue for ordinary cleanup, documentation gaps, test
ideas, minor refactors, or observations that belong in the current change.

If an independently actionable critical issue needs maintainer attention, report
only its impact, evidence, recommended next action, and acceptance criteria in
the handoff. The supervisor checks for duplicates and owns any external issue
or pull-request publication. Limit candidates to one per stage and never
include secrets, credentials, or Supervisor control tokens.

Agents may edit only the issue worktree and own local Git there: fetch, rebase
onto `origin/<base>`, add, and commit. They must not push, invoke GitHub/`gh`,
create or update PRs, start the next role, rewrite the base branch, or change
remotes. The supervisor owns state transitions, pushes, pull requests, CI
waiting, labels, and process termination. It may still run a final safety-net
rebase immediately before publication.

GitHub's required checks are the merge authority: the supervisor waits for all
required checks after PR creation, never reports a PR merge-ready from local
results, and pauses new feature intake while the base commit's CI is red (see
`wiki/operations/ci-authority.md`).

## Integration cadence

We merge quickly once work is ready. Keep changes focused, surface blockers
early, and do not leave reviewable or passing work waiting unnecessarily.

Workers rebase onto the latest base themselves during implement, review, and
repair work. Do not ask the supervisor to rebase for you; do not claim the
branch was published until the supervisor has pushed and created or updated the
PR.

During long work, write an atomic JSON heartbeat to the path named in the worker
file. Keep each message concise but useful to a future restart: mention what is
done and the next step when those details are known:

```json
{ "status": "working", "message": "Implementing the requested change" }
```

The supervisor journals meaningful changes to the progress history path in the
worker metadata, flushes a final heartbeat when the process exits, and includes
prior-attempt notes (journal, latest `progress.json`, and a handoff digest) in a
later worker invocation. Treat that history as context only and verify it against
the worktree and logs; the latest heartbeat remains available in that attempt's
`progress.json`.

Before exiting, write the required handoff JSON to its named path. Follow the
handoff contract embedded in the worker file (schema + success example). Its
`status` must equal the success status from the worker file, or be `blocked`,
`not_possible`, or `not_needed`. A blocked handoff must explain the exact
product decision needed. Use `not_possible` when the task cannot be completed,
or `not_needed` when the requested work is already implemented; include a
concise summary of why. For a GitHub issue, the supervisor posts that summary
as an issue comment and ends the workflow.

Do not add other keys. After writing the handoff, wait for the sibling
`handoff.feedback.json` named in worker metadata. Exit only when it reports
`{"ok": true}` for the current handoff contents. If it reports `"ok": false`,
read `error`, fix the handoff, and wait again.

During implementation, review, and repair, do not run the full test suite,
coverage, the full build, or the full e2e suite; CI owns the full product gate
after the PR exists. Run focused checks once — on the files you changed and the
smallest relevant unit-test selection — before handoff, and do not run checks
after every edit or loop on validation. Installed pre-commit hooks run
automatically on every commit, so do not invoke them by hand. The reviewer
records focused local validation but does not act as a second merge authority:
GitHub's required checks decide mergeability, and the supervisor waits for them
after PR creation. The gate is repository-aware: detect the repository's
configured quality commands before running them (read `AGENTS.md`, the
package-manager manifest, and CI workflows) and use those instead of a fixed
command list. Python/uv repositories keep the generic `uv run pre-commit run
--all-files`; TypeScript/npm repositories use focused commands (`npx prettier
--check <changed-files>`, `npx eslint <changed-files>`, `npm run typecheck`,
`npm test -- <relevant-test-file>`). Worker handoffs record the validated base
SHA and distinguish local checks from required CI.

The supervisor tracks heartbeat freshness separately from meaningful progress.
Meaningful progress changes the `status`, `stage`, or `message` fields; repeating
the same heartbeat and log output do not reset the configured no-progress
timeout. The bundled defaults are 30 minutes for implementation and 10 minutes
for review and PR repair, with a five-minute startup grace. Configure role
defaults under `[runner]`, or override `stall_timeout_seconds` and
`startup_grace_seconds` on an agent stage. Status exposes the active timeout and
meaningful-progress age. Paused time is excluded. When the timeout is reached,
only the worker process tree is terminated. The job is persisted as failed with
a stall reason and can be safely retried after the process has exited; an
operator can stop it first if it is still running.

The operator status view exposes these signals independently: process liveness
(`pid_alive`), the age of the latest heartbeat, the age of the latest change to
`status`, `stage`, or `message`, the configured no-progress timeout, and a
health/reason classification. Log output is diagnostic only; growing a log
does not count as meaningful progress or reset the stall timer. `sv job status`
and `sv job inspect` show the same fields, and the control API returns them in
its status and job responses.
