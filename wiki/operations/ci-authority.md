# CI authority

GitHub's required checks are the authoritative merge gate. Local validation
provides feedback before publication, but it does not replace the checks
configured in `.github/workflows/ci.yml`.

External workflow actions are pinned to immutable commit SHAs; `npm run lint:actions`
guards that policy across every workflow file.

## Workflow lifecycle

The `CI` workflow uses a workflow-specific concurrency group for each pull
request, so a newer pull-request commit cancels older pending or in-progress
`check` and `e2e` runs. Pushes to `main` use a separate ref-based group and are
never cancelled by pull-request runs. The group includes the workflow identity,
so it cannot overlap with Pages or the manually triggered performance workflow.

Coverage artifacts are retained for 7 days on pull requests and 14 days on
`main`: pull-request coverage is primarily a current-review aid, while the
longer-lived main artifact supports historical investigation. Failure-only
Playwright reports remain available for 14 days so no-GPU e2e diagnostics are
not lost when a run fails.

The required `e2e` job runs only the WebGPU-unsupported smoke. It uses the
Ubuntu runner's installed branded Google Chrome, verifies its executable and
version before launching Playwright, and does not download a Playwright browser.
The full hardware-WebGPU lane remains local; the CI smoke must not enable
SwiftShader or imply visual WebGPU coverage. The manually dispatched
`Hardware WebGPU conformance` workflow is a separate evidence lane over a
bounded deterministic journey. It targets explicitly labelled Apple and
Windows/NVIDIA self-hosted runners, retains browser/adapter JSON and
desktop/mobile screenshots for 30 days, and fails when requested hardware is
unavailable. It is not a required branch-protection context and does not compare
frame rates across devices.

The required `check` context is a small aggregator over three parallel jobs:
`check-static` owns pre-commit, formatting, type checking, linting, and API
documentation validation;
`check-runtime` owns non-demo library coverage, while `check-package` owns
performance budgets and package smoke tests. Demo coverage remains in
`check-runtime` through its dedicated core and component suites, so those tests
run once and retain their independent coverage thresholds and reports.
`check-static` restores and saves ESLint's content-addressed cache. It still
checks every changed source file and invalidates on dependency or lint-config
changes; the cache only avoids rechecking unchanged files from an earlier run.
The aggregator runs even when a dependency is skipped, cancelled, or fails, and
returns failure unless all three shards succeed. `e2e` remains an independent
required context.

The required `check` job's pre-commit step runs the pinned actionlint semantic
workflow check. It is intentionally separate from `npm run lint:actions`, which
enforces femgx's stricter immutable full-SHA policy for external actions.

## Merge decision

- **Pending or missing checks** keep a pull request unmergeable.
- **Failing checks** must be repaired before merge.
- **Successful required checks** allow GitHub to merge once any required review
  and branch-protection conditions are also satisfied.

## Base health

Before starting substantial feature work, check that the target base branch is
healthy. If its required checks are failing, prioritize repairing the base and
re-run the full CI gate before building unrelated work on top of it.
