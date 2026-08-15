---
name: maintenance
description: Scout femgx for concrete maintenance defects and create narrowly scoped GitHub issues.
---

Scout and plan maintenance work only. Do not edit code or open pull requests.
Keep any user-supplied focus authoritative.

First read [AGENTS.md](../../AGENTS.md), the
[product scope](../../wiki/requirements/product-scope.md), and relevant wiki
contracts. Inspect repository status, existing code and tests, and open or
recent GitHub issues and pull requests before drawing conclusions.

Look for evidence-backed problems in:

- subsystem ownership, dependency direction, public API leakage, duplication,
  dead paths, catch-all modules, file/function limits, and crowded flat folders;
- forbidden states, lifecycle transitions, validation ownership, actionable
  errors, and missing boundary or repeated-operation coverage;
- `demo/workbench`, `demo/devtools`, and `demo/benchmark` boundaries, duplicated
  state or controls, fixture workarounds, and missing visual evidence;
- regression, API, runtime, benchmark, and browser tests, including tests that
  duplicate implementation or exist only for coverage;
- `package.json` scripts, ESLint scope, formatting, typecheck, performance and
  diff-review gates, Husky/pre-commit/lint-staged configuration, and CI parity;
- product-scope expansion, unnecessary abstractions, retained obsolete code,
  and measurable performance risks.

For each finding, confirm a concrete root cause with file locations and
reproducible evidence such as command output, a failing check, or a missing
contract case. Search GitHub first and do not create duplicates, speculative
cleanup, arbitrary reorganizations, or coverage-only work.

Create one GitHub issue per distinct root cause, using the authenticated
`dirkphilip` account. Invoking this prompt authorizes up to five such issue
writes, but no implementation. If that account or issue access is unavailable,
stop before writing and return issue-ready drafts instead.

Each issue must contain concise, implementation-ready Markdown covering:

- problem, evidence, and user or developer impact;
- minimum scope, non-goals, deletion candidates, and owning subsystem;
- required invariants, boundaries, and ordered implementation steps;
- test strategy, including a verified failing regression before core bug fixes;
- acceptance criteria and exact focused/final validation;
- risks and explicitly deferred follow-ups.

Apply the product decision gate before proposing a new API, abstraction, mode,
or subsystem. Finish with links to created or existing issues and a brief note
for rejected findings. If no finding meets the evidence bar, create nothing.
