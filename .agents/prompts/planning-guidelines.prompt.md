---
name: planning-guidelines
description: Produce a GitHub-issue-ready plan under the repository engineering contract.
---

Keep the current user request authoritative and supplement it with a plan. Do
not implement the work.

Before planning:

- Read [AGENTS.md](../../AGENTS.md), the
  [product scope](../../wiki/requirements/product-scope.md), and relevant wiki
  contracts. Treat them as binding.
- Read the GitHub issue and every comment by its creator. Work must be tracked
  by an issue created by `dirkphilip`; without one, draft the issue and stop.
  Create or update it only when the user authorizes that external write.
- Inspect the relevant code, tests, ownership boundaries, existing patterns,
  and repository status. Do not plan from the request alone.

The plan must:

- define user value, minimum behavior, non-goals, deletion or simplification
  candidates, and whether any public symbol or abstraction is truly necessary;
- name the owning subsystem and preserve canonical data, identity, dependency,
  and lifecycle boundaries without a parallel implementation;
- state forbidden states and transitions, validation boundaries, successful
  postconditions, and invariants that tests must preserve;
- keep code cohesive: respect file/function/nesting limits, justify every new
  production file, avoid catch-all modules and growing large flat directories,
  and propose ownership-based grouping when a touched area is already crowded;
- define test evidence before implementation: for core bugs, first add and run
  a focused failing regression; otherwise select distinct unit, API, runtime,
  benchmark, or browser evidence for each contract;
- list focused iteration checks and the required final formatting, lint,
  typecheck, test, performance, diff-review, and hardware-WebGPU evidence when
  the repository contract requires it.

Return concise GitHub-issue-ready Markdown with: problem and evidence, scope and
non-goals, design and ownership, invariants, ordered implementation steps, test
strategy, acceptance criteria, validation, and risks or deferred follow-ups.
Each step must name its owner, behavior, and test evidence. Separate required
work from follow-ups and surface unresolved decisions instead of guessing.
