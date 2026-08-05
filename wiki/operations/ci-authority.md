# CI authority and base-health intake

GitHub's required checks decide whether a supervised PR may merge. Local
worker validation is advisory only and never gates mergeability; the Supervisor
waits for the repository's required checks and reports a base-health blocker
instead of starting new feature work on a broken base.

## Merge decision

The committed workflow (`.supervisor/config.toml`) publishes the PR
(`submit_pr`) and then runs a `ci` (`wait_for_ci`) stage that blocks until all
required GitHub checks pass (`github.ci_timeout_seconds`):

- **Pending/missing checks** keep the workflow waiting; it cannot advance to
  merge.
- **Failing checks** block the workflow; PR maintenance may trigger a repair
  pass (`github.repair = true`) and the operator can launch
  `sv job repair ISSUE` directly.
- **Successful checks** let the workflow complete; `github.auto_merge = true`
  then asks GitHub to merge once required checks and approvals are satisfied.

The Supervisor reads GitHub's check status (`gh pr checks`) and does not
re-run the repository's CI commands — CI implementation lives in
`.github/workflows/ci.yml`, not in the Supervisor.

## Reviewer role

The reviewer runs focused local checks once and records them in the handoff
`tests_run`. It does not run the full product gate and is not a second merge
authority: local findings inform the PR, but mergeability is GitHub's required
checks. See [[operations/supervisor-workflow|Supervisor workflow]] and
`test/supervisor/worker-contract.test.ts`.

## Handoff reporting

Worker handoffs identify the validated **base SHA** in `summary` and list the
**local checks** they ran in `tests_run`, so a handoff distinguishes local
validation from required CI. The Supervisor's handoff JSON schema is fixed by
the app (only `status`, `summary`, `tests_run`, `blocker`), so these fields are
reported inside those keys, never as invented extra keys.

## Base-health intake gate

Before starting new feature work, the Supervisor performs a lightweight health
check against the current base commit. When the base is red:

- new feature intake pauses (no new feature jobs launch);
- the workflow reports a **base-health blocker**;
- repair work on the broken base remains possible (a repair PR restores green
  CI, after which intake resumes).

Known limitation: enforcement of the intake health check requires the
Supervisor to read the base commit's required-check status before auto-pulling,
a capability the bundled `sv` app does not expose yet. Until it lands, operate
the gate manually: check base health (e.g.
`gh api repos/{owner}/{repo}/commits/{sha}/status` for the current `main` HEAD)
and `sv pause` intake while it is red. See `wiki/operations/development-loop.md`.

## Contract tests

`test/supervisor/ci-authority.test.ts` locks the policy: the workflow declares
the `ci` stage after `submit_pr`; the merge decision treats any pending or
failing required check as not merge-ready and only all-passing as merge-ready;
and the intake decision permits feature work only on a healthy base.
`test/supervisor/supervisor-config.test.ts` and
`test/supervisor/worker-contract.test.ts` lock the config and prompt contract.
