# Worker messaging protocol

The supervisor generates a worker file for every role invocation under
`.supervisor/run/jobs/<N>/stages/<stage>/<NNN>/worker.md`. It starts the
coding agent with a short prompt that points to that file; the worker file is
the authoritative contract.

Agents may edit only the issue worktree and own local Git there: fetch, rebase
onto `origin/<base>`, add, and commit. They must not push, invoke GitHub/`gh`,
create or update PRs, start the next role, rewrite the base branch, or change
remotes. The supervisor owns state transitions, pushes, pull requests, CI
waiting, labels, and process termination. It may still run a final safety-net
rebase immediately before publication.

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
{"status":"working","message":"Implementing the requested change"}
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

During implementation and repair, do not run the test suite or full
repository validation loops; CI also covers that after the PR exists. Before
those handoffs, run pre-commit at most once when the worker contract asks for
it. During review, run pre-commit once and the test suite once.

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
