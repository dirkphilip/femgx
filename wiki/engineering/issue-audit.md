# Open issue audit — August 2026

This note records the backlog review performed against the authoritative
[[requirements/product-scope|product-scope contract]] on `main` at `b524e73`.
The GitHub issue state remains authoritative; this note preserves why issues
were retained, completed, or closed as not planned.

## Retain and implement

| Issue | Decision               | Scope carried forward                                                                                                                   |
| ----- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| #95   | Core now               | Replace the per-triangle emphasis scan with bounded constant-time lookup; retain diffed CPU/GPU updates.                                |
| #97   | Core now               | Skip zero-length edge-overlay draws before pipeline/bind-group work.                                                                    |
| #118  | Core now               | Reuse the uploaded vertex-position buffer for node picking; do not change public pick targets.                                          |
| #119  | Core now               | Treat any non-finite bound component as always-visible in runtime culling and viewport bounds.                                          |
| #125  | Core now               | Add a compile-only negative probe for topology key/family/order pinning.                                                                |
| #127  | Core now               | Abort all current `WorkbenchController` DOM/window listeners on destroy; CPU-fallback wording is obsolete.                              |
| #139  | Core now               | Reset the complete current demo workbench state, with the contract visible in UI/docs.                                                  |
| #117  | Engineering cleanup    | Split the remaining demo controller concerns without changing its public presentation behavior.                                         |
| #194  | Core now               | Add one static results configuration to the viewport: scalar/derived elemental colors, range/map, and nodal GPU deformation with clear. |
| #155  | Project infrastructure | Document and enforce the current WebGPU-only required CI checks; no CPU fallback lane.                                                  |
| #196  | Project infrastructure | Audit root exports after the canonical results workflow and remove implementation-detail exports.                                       |
| #199  | Project infrastructure | Keep the scope gate, issue-template decision questions, and deferred-intake policy explicit.                                            |

Issue #192 is already satisfied on `main` by the canonical viewport facade,
demo integration, lifecycle tests, and README example; it is closed as
completed rather than reimplemented.

## Closed as not planned

- #101 and #105: CasePlayer/playback and the old results-demo architecture were
  removed from the product contract. The single-case and GPU-alignment notes
  remain historical context; static viewport results are covered by #194.
- #107 and #115: large-model streaming/LOD and the cumulative attach-growth
  optimization belong to the removed streaming product path. The current
  attach-growth benchmark remains a local implementation guard, not a promise
  to restore streaming.
- #111 and #112: Gmsh parsing is outside the single VTK interchange contract.
  The zero-string-tag and non-numeric-real diagnostics remain historical notes.
- #168: the issue body is empty and asks for supervisor-runtime behavior that is
  already represented by the committed worker protocol and belongs upstream.
- #197: real-GPU CI remains valuable, but this repository has no hardware or
  self-hosted GitHub Actions runner. The local system-Chrome WebGPU lane and
  no-GPU unsupported smoke remain the honest supported checks. Reopen when a
  real runner, artifact retention, and ownership are available.

The open Dependabot PR #150 is closed because TypeScript 7.0.2 is incompatible
with the repository's current `typescript-eslint@8.66.0` peer range; it fails at
`npm ci` before any project check runs. It can be regenerated after the lint
toolchain supports TypeScript 7.

Related: [[engineering/todo|Engineering TODO]],
[[engineering/quality-gate|Quality gate]],
[[operations/ci-authority|CI authority and base-health intake]], and
[[architecture/api-design|API design north star]].
