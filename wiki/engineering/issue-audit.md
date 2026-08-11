# Open issue audit — August 2026

This note records the backlog review against the authoritative
[[requirements/product-scope|product-scope contract]]. The audit was refreshed
on `main` at `ee0b2c1`; GitHub issue state remains authoritative, while this
note preserves the value decision, delivery mapping, and closure rationale.

## Retained and delivered

Every retained issue from the audit is now closed as `completed`:

| Issues                     | Decision                 | Delivery                                                                                                                                         |
| -------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| #95, #97, #118, #119, #125 | Core correctness         | PR #226: constant-time emphasis lookup, zero-length edge no-ops, shared node-pick positions, non-finite-bound culling, and topology type probes. |
| #117, #127, #139           | Demo engineering cleanup | PR #230: focused workbench modules, abortable listener ownership, complete reset semantics, and lifecycle-safe results controls.                 |
| #192                       | Core facade              | Previously complete on `main`: the canonical `FemViewport` facade, demo integration, lifecycle tests, and README workflow.                       |
| #194                       | Core results workflow    | PR #227: static elemental scalar/derived colors, range/map resolution, nodal GPU deformation, and clear/reset behavior.                          |
| #196                       | Public API audit         | PR #229: removed accidental implementation-detail root exports and documented the deliberate advanced surface.                                   |
| #199                       | Product infrastructure   | PR #225: decision gate, issue-template questions, deferred-intake policy, and this audit trail.                                                  |
| #155                       | CI infrastructure        | PR #228: documented the WebGPU-only gate; the active `main` ruleset now requires strict `check` and `e2e` contexts with no bypass actors.        |
| #232                       | Core scene metadata      | PR #247: reusable part body metadata, validation, and deterministic body ownership.                                                              |
| #233                       | Core interaction         | PR #248: body-aware visibility, styling, highlighting, and GPU picking in the demo.                                                              |
| #234                       | Performance              | PR #249: synchronous `FemViewport.batch`, coalesced visibility writes, and a representative budget.                                              |
| #235, #236                 | Demo and test quality    | PRs #243 and #242: camera-aligned axis widget and test-suite consolidation.                                                                      |
| #237                       | Core rendering           | PR #254: validated face subsets with compact GPU index orders and preserved picks.                                                               |
| #239, #240                 | Core element topology    | PRs #250 and #251: validated linear triangle/quad and polygon authoring paths.                                                                   |
| #241                       | Core element rendering   | PR #256: heterogeneous linear models grouped into reusable triangle, line, and point parts with preserved metadata and result/pick paths.        |
| #244, #245, #246           | Demo interaction         | PR #258: empty-space clearing, plain replacement, Control/Meta additive selection, and a clamped view context menu.                              |

The adjacent infrastructure issues #205–#208 were already complete when this
audit began: demand-driven GPU picking, displayed pick-depth recovery, the
real-WebGPU benchmark, and the idle-demo fix remain part of the delivered
product. Issue #209 is closed as completed by the same roadmap-gate work.

## Closed as not planned

These issues were reviewed and closed with `state_reason=not_planned` because
their premises are outside the current product contract:

- #101 and #105: CasePlayer/playback and the old results-demo architecture were
  removed from scope. Static viewport results are covered by #194.
- #107 and #115: large-model streaming/LOD and cumulative attach-growth work
  belong to the removed streaming path. The current attach-growth benchmark is
  an implementation guard, not a streaming promise.
- #111 and #112: Gmsh parsing is outside the single VTK interchange contract;
  their malformed-tag diagnostics remain historical context.
- #168: the issue is empty and asks for supervisor-runtime behavior already
  represented by the committed worker protocol and owned upstream.
- #197: real-GPU CI remains valuable, but this repository has no hardware or
  self-hosted GitHub Actions runner. Hosted `e2e` validates the unsupported
  contract; local system Chrome validates real WebGPU. Reopen when a runner,
  artifact retention, and ownership are available.

The TypeScript 7 Dependabot PR #150 was also closed because it fails `npm ci`
against the current `typescript-eslint@8.66.0` peer range. Regenerate it after
the lint toolchain supports TypeScript 7.

## Result

The audited backlog has no open issues. Future breadth work still requires a
new decision-gate issue that states user value, minimum behavior, deletion
candidates, explicit non-goals, and why an existing abstraction is insufficient.

Related: [[engineering/todo|Engineering TODO]],
[[engineering/quality-gate|Quality gate]],
[[operations/ci-authority|CI authority and base-health intake]], and
[[architecture/api-design|API design north star]].
