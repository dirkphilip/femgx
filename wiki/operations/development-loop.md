# Development loop

Use this playbook to improve femgx continuously with Agent Supervisor while
keeping every change reviewable, testable, and easy to stop. The canonical
Supervisor command reference lives in [[operations/supervisor-workflow|Supervisor
workflow]]; this note defines the higher-level operating loop.

## Outcome

Turn one prioritized improvement into a merged change, capture newly discovered
work as focused issues, and repeat until the backlog is empty or an explicit
stop condition is reached:

```text
inspect backlog → find a concrete improvement → file or refine an issue
    → approve it → sv run ISSUE → monitor → repair if needed
    → verify checks → merge PR → sync main → re-triage
```

Do not run an unbounded loop without checking state. “Keep going” means resume
this cycle after each completed transition, not bypass approvals, quality
gates, or a maintainer decision.

## One-time setup

From the repository root, verify the local prerequisites before starting a long
run:

```sh
gh auth status
uvx --from /Users/dirkphilip/workspace/agent-supervisor sv status --json
git status --short --branch
```

Use the repository’s committed `.supervisor/config.toml` plus a private
`.supervisor/config.local.toml`. Keep the provider authenticated, give each
Supervisor instance a distinct label suffix, and keep runtime state ignored.
Always launch Supervisor through `uvx`:

```sh
alias sv='uvx --from /Users/dirkphilip/workspace/agent-supervisor sv'
```

Before using auto-intake, confirm that `github.allow_labels` contains
`ready-for-supervisor`. An issue is not approved merely because it exists; the
operator adds that label after reviewing its scope and dependencies.

## Triage and issue filing

Start each cycle by inspecting both the repository and GitHub state:

```sh
git fetch origin main
gh issue list --state open --limit 50
gh pr list --state open --limit 50
sed -n '1,260p' wiki/engineering/todo.md
sed -n '1,260p' wiki/engineering/performance-issues.md
```

Prefer one issue that can produce one focused PR. Check for duplicates before
filing. Use this structure:

```text
Title: [area] concise outcome

Problem
- What is missing or incorrect?
- What evidence or reproduction shows it?

Outcome
- What observable behavior should change?

Scope and acceptance criteria
- Explicit tests, API behavior, performance budget, or demo behavior.
- Explicit non-goals when the change could expand.

Dependencies
- Link prerequisite issues or state “none”.
```

File and approve an issue as separate actions:

```sh
gh issue create --title "[scene] preserve stable instance handles" --body-file /tmp/femgx-issue.md
gh issue edit ISSUE_NUMBER --add-label ready-for-supervisor
```

Use the label only for work that is actionable, bounded, and safe to run. Do
not auto-approve speculative ideas, duplicate issues, changes that need an
unmade product decision, or work that would change deployment/secrets.

## Running and monitoring Supervisor

Run one issue explicitly for a controlled first pass, or start a detached run
for an approved queue:

```sh
sv run ISSUE_NUMBER
sv run --detach
sv status --json
sv job status --json
```

Monitor meaningful progress rather than log volume. A healthy job moves from
implementation to review to pull request; repeated heartbeats without a changed
stage, status, or message are not progress. Inspect a stalled or unclear job
before acting:

```sh
sv job inspect ISSUE_NUMBER --json
sv job logs ISSUE_NUMBER --stage implement --follow
sv job logs ISSUE_NUMBER --stage review --follow
```

Use only the lifecycle action justified by the observed state:

```sh
sv job pause ISSUE_NUMBER --json
sv job resume ISSUE_NUMBER --json
sv job retry ISSUE_NUMBER --json
sv job repair ISSUE_NUMBER --json
sv job stop ISSUE_NUMBER --json
```

Pause intake before a planned handoff or shutdown so active work can drain:

```sh
sv pause
sv status --json
```

Never edit `.supervisor/issues.json`, `.supervisor/run/`, or job handoff files
by hand to force a state transition. Never expose the local Supervisor control
token or runtime URL.

## PR completion and merge

Supervisor creates a regular pull request and owns publication/status
synchronization. The current Supervisor does not auto-merge; the operator owns
the final merge decision. For each `awaiting_merge` job:

```sh
sv job sync ISSUE_NUMBER --json
gh pr checks PR_NUMBER
gh pr view PR_NUMBER --comments
```

Merge only when the PR is focused, review feedback is resolved, required checks
are green, and the implementation still matches the issue. Prefer a squash
merge, then verify the local base branch:

```sh
gh pr merge PR_NUMBER --squash --delete-branch
git fetch origin main
git switch main
git pull --ff-only origin main
```

If checks or review fail, use `sv job repair ISSUE_NUMBER` and re-check the PR;
do not start a second implementation job for the same issue. If a merge
conflict appears, let the worker or repair stage rebase its own worktree and
then sync again.

## Post-merge discovery

After every merge:

1. Read the changed files and tests on `main`.
2. Run the project quality gate locally.
3. Re-read `wiki/engineering/todo.md`, `wiki/engineering/performance-issues.md`, and relevant design
   notes.
4. Record a newly discovered issue only when it is distinct, actionable, and
   has a clear payoff. Link the originating PR and the relevant wiki note.
5. Add `ready-for-supervisor` only after triage; then choose the next issue by
   dependency order and risk, not by creation time alone.

The worker prompts also ask implementers and reviewers to report material
improvements. Treat those reports as candidates: deduplicate and triage them
before approval. The current OpenCode setup may prevent workers from invoking
`gh`; the operator loop must still capture their handoff notes and file the
issue itself when needed.

## FEMGX priority order

Use this order when the backlog needs a next issue:

1. Correctness foundations: column-major matrix multiplication, stable picking
   identity, hierarchy validation, and deep-tree safety.
2. Scalable scene/runtime state: packed storage, dirty-subtree updates,
   delta-based visibility, deterministic per-part batching, and bounds culling.
3. Rendering: WebGPU lifecycle, one-time part geometry uploads, instanced
   linear and quadratic 2D/3D hex and tet primitives, style/selection buffers,
   and asynchronous GPU picking.
4. Interaction: part and instance highlight/selection/hover, color changes
   without material cloning, visibility inheritance, and a stable `pick(x, y)`
   result.
5. Demo and validation: runnable Vite demo, orbit/pan/zoom/reset, orthographic
   and perspective cameras, WebGPU fallback, representative FE fixtures,
   Playwright coverage, and performance budgets.

Every rendering or interaction issue should state its expected batching,
allocation, or frame-time behavior. Every element-topology issue should name
the supported node ordering and include a small fixture or CPU-side test before
it is approved for GPU work.

## Stop conditions

Stop intake and report to the maintainer when any of these is true:

- the next issue needs a product/API decision not captured in the repository;
- required checks, credentials, provider access, or WebGPU test capability are
  unavailable after the safe local alternatives are exhausted;
- the same job fails or stalls repeatedly without a new diagnosis;
- the working tree contains unrelated user changes or a merge would overwrite
  them;
- the next change would be broad enough to require a new architectural plan;
- the quality gate is red and the failure is unrelated to the current issue.

When stopping, leave a concise issue or wiki note with evidence, the exact
command/state that blocked progress, and the smallest next action. A clean,
paused queue is preferable to silently accumulating failed or ambiguous jobs.

## Quality gate

Before and after a long run, use the commands required by `AGENTS.md`:

```sh
npm run format
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
```

Run the full gate after merging a logical batch, and use focused tests while
triaging. Leave the repository clean except for intentionally uncommitted user
work. Update [[engineering/todo|Engineering TODO]], [[engineering/performance-issues|Performance issues
and risks]], or a more specific wiki note whenever the implementation changes
the roadmap or exposes a reusable pitfall.
