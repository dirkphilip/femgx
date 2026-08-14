# AGENTS.md

## Product status and scope

This is an **experimental product** (version 0.1.0) with no stable API. Prefer a
cleaner design over backwards compatibility.

Before changing the repository, read the authoritative
[[requirements/product-scope|product scope and requirements contract]]. It
defines the supported product, deferred capabilities, removals, and detailed
behavior; if this file conflicts with it, the scope contract wins.

Hard boundaries worth repeating:

- Rendering is WebGPU-only. A missing or failed device produces a typed
  unsupported result or clear error, never a CPU renderer or other fallback.
  Capability probing and supported-path device recovery remain WebGPU features;
  do not turn them into fallback machinery.
- The canonical product path is reusable parts placed through hierarchical
  assemblies, compiled into one packed `SceneRuntime`, and consumed by
  `FemViewport`. Preserve instancing and host-mappable GPU interaction ids.
- Every viewport also renders one renderer-owned positive X/Y/Z triad at world
  origin. It is scaled from complete placed-scene bounds, remains out of scene
  identity, bounds, picking, and interaction, and is opaque when depth-visible
  with a fixed-alpha weighted-transparency ghost behind opaque model geometry.
- Near-term results are authored scalar fields at nodal or elemental locations,
  with authored nodal vectors retained for deformation. Authored elemental
  orientation glyphs are a bounded Core-now role; femgx-derived
  engineering quantities, magnitude plots, and nodal/tensor glyphs remain out
  of scope.
- Element through-intersection box selection is a Core-now, host-side query over
  authoritative placed FE geometry. It ignores raster occlusion but respects
  explicit visibility, section planes, deformation, and occurrence transforms;
  it must add no GPU pass, buffer, attachment, readback, renderer fallback, or
  generalized geometry-query subsystem.
- Do not expand deferred or removed capabilities. Existing deferred code is
  removed only through an explicit product decision, not to improve a diff.
- Do not add a public API, subsystem, fallback, compatibility layer, or optional
  mode without an explicit requirement.

Before proposing an addition, answer the scope contract's
[[#decision-gate|decision gate]]:

1. What concrete user value does it provide?
2. What is the minimum behavior that provides that value?
3. What existing code or abstraction can be deleted or simplified instead?
4. What remains explicitly out of scope?
5. Is a new abstraction or public symbol necessary?

Routine investigation, fixes, and maintenance do not need a manufactured scope
proposal.

## Clean design

Clean code is a product requirement. Seek the smallest coherent design that is
correct, readable, and complete.

- Extend an existing pattern when it fits; do not create a parallel abstraction
  or duplicate implementation.
- Treat production lines, modules, branches, guards, and abstractions as costs.
  Minimize them deliberately and justify every net increase. Do not compress
  readable code or omit required behavior to manufacture a smaller number.
- Deletion-first means removing code made obsolete by the requested design and
  looking for simplifications before adding machinery. It does not mean
  deleting useful, in-scope behavior merely to achieve a negative line delta.
- Refactor when it directly supports the requested change and materially
  improves the touched design. Keep broader cleanup separate and reviewable.
- Leave touched code cleaner: remove obvious dead code and local duplication,
  and fix trivial naming or formatting issues. Do not turn that duty into an
  unrelated rewrite.
- Add runtime guards only at public, untrusted, or ownership boundaries where
  invalid state is representable and the failure is actionable. Do not recheck
  invariants already established by a validated boundary.
- Add comments only for non-obvious design decisions; prefer clear code over
  narration.

Correctness, clarity, and retained useful behavior govern. Raw line count is a
review signal, not the objective.

### Contracts and negative space

Use [[engineering/state-invariants|invariant-driven state design]] as the
repository's negative-space programming practice: define forbidden states and
transitions, state preconditions at public, untrusted, and ownership boundaries,
and make successful postconditions and preserved invariants testable.

- Keep actionable boundary and lifecycle checks enabled in production. Avoid
  repeated cost by validating once at the owning boundary, not with a broad
  development/production contract switch.
- Put exhaustive or expensive internal invariant verification in focused tests
  unless silent corruption could cross an ownership boundary. Internal helpers
  should rely on invariants already established by their caller.
- Fail with descriptive, domain-appropriate errors or typed results, and test
  forbidden, boundary, inverse, round-trip, and repeated-operation paths.

## Architecture and ownership

This TypeScript library renders finite-element models with WebGPU and GPU
instancing. The authoritative CPU scene compiles into a packed `SceneRuntime`;
the renderer synchronizes per-frame deltas to per-instance GPU state.

Production ownership under `src/`:

- `math/`, `geometry/`, `elements/` — math, reusable geometry, FE topology, and
  tessellation.
- `scene/`, `scene-runtime/` — authoritative model identities and the derived
  packed runtime.
- `camera/`, `interaction/`, `picking/` — camera math, interaction state, and
  internal GPU pick-id resolution.
- `results/` — authored scalar/vector fields, ranges, color mapping, and
  nodal deformation.
- `io/` — validation, diagnostics, VTK legacy interchange, and the narrow GLB
  display-scene importer defined by the scope contract.
- `platform/`, `renderer/`, `viewport/` — WebGPU lifecycle, rendering, and the
  canonical public lifecycle facade.

Place new domain code in its owning subsystem and prefer intra-subsystem
imports. Production modules use the owning subsystem's exported surface and
must not import the root barrel. The only public entry point is `src/index.ts`;
anything it does not export is internal. Do not expose runtime slots, GPU record
layouts, storage capacities, or other derived implementation details by
default.

Tests under `test/` mirror subsystem ownership, with deliberate repository-level
suites under `test/demo`, `test/public-api`, `test/runtime`, and `test/scripts`.
The demo is split between user-facing `demo/workbench/`, diagnostics and browser
harness code in `demo/devtools/`, and the opt-in `demo/benchmark/`.

### Public API north star

The canonical workflow is part definitions and assembly placements registered
in a `Scene`, compiled into one `SceneRuntime`, and consumed by `FemViewport`.
See [[architecture/api-design|API design north star]].

- Geometry is defined once and referenced by instances; placements do not copy
  it.
- The CPU scene owns model data; runtime arrays and GPU buffers are derived.
- Keep part definitions, part instances, assembly definitions, registries, and
  runtime slots semantically distinct.
- A new public concept needs a clear owner, identity and data-ownership story,
  place in the canonical flow, end-to-end example, and API-level test.

## Engineering standards

- Use modern strict TypeScript. Prefer explicit types, `satisfies`, readonly
  data, const objects, pure transitions, and immutable CPU-side state. Avoid
  `any`.
- Follow the contracts and negative-space rules above.
- Every test must protect a distinct public contract, regression, boundary, or
  invariant. Prefer extending an existing table or golden case; do not mirror
  implementation, duplicate assertions, or add tests only for coverage. Delete
  superseded tests when a stronger one subsumes them.
- Keep WebGPU behind thin interfaces where CPU behavior can be tested without a
  GPU. Use real browser evidence for rendering behavior.
- ESLint enforces 400 implementation lines per file, 60 lines per function, and
  nesting depth 4; 300 file lines is a design-review threshold. Split only when
  it improves cohesion.
- Document exported public symbols with TypeDoc or JSDoc.

Fix visual failures at their source by inspecting renderer, shader, pipeline,
camera, and geometry contracts before changing fixtures. Do not hide defects
with duplicate faces, proxy volumes, or similar fixture workarounds. Linear 2D
surfaces remain inspectable from either side unless an explicit product decision
introduces culling.

### Validation

`package.json` is the command authority. Targeted checks are appropriate while
iterating. Before handing off a code change, format the intended files and run:

- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run bench:budget`
- `npm run review:diff`

Use `npm run format` only when the worktree has no unrelated changes; otherwise
run Prettier on the intended files. For documentation-only changes, a focused
Prettier check, `git diff --check`, and `npm run review:diff` are sufficient.
Leave no unrelated or generated changes behind. See
[[engineering/pre-commit-hooks|pre-commit hooks]] for commit setup.

CI runs formatting, typecheck, lint, coverage, performance budgets, builds,
package smoke tests, and the no-GPU unsupported-contract e2e smoke. It does not
replace hardware-WebGPU visual validation; see
[[operations/ci-authority|CI authority]].

Before merging rendering, camera, interaction, demo, CSS, or responsive-layout
changes, run the real system-Chrome WebGPU lane and inspect screenshots at
desktop and 390×844 mobile sizes. A submitted-frame counter, mock, or no-GPU CI
pass is not visual evidence; a black or blank canvas blocks merge. Performance
guidance lives in [[engineering/benchmarks|Benchmarks]].

## Workflow and reporting

- Inspect repository status before editing and preserve unrelated user changes.
- Keep one logical change per PR or commit and avoid unrelated refactors.
- Before committing, use `npm run review:diff` to inspect unnecessary code,
  duplication, obsolete paths, and weakened tests.
- Report production-source and test/documentation line deltas separately.
  Explain production growth in terms of distinct product value; coverage alone
  does not justify more core code, guards, or tests.
- Surface bugs, design smells, performance risks, scope expansion, and
  inconsistencies instead of silently working around them. Prefer the smallest
  proper fix; report larger or out-of-scope work separately.
- Create or update GitHub issues only when the task includes issue tracking or
  the user authorizes the external write. Otherwise propose the issue in the
  handoff.
- Update this file only when architecture, commands, or agent policy materially
  changes.

## Internal wiki

The plain-Markdown `wiki/` is durable memory for humans and future agents;
GitHub issues and PRs remain the work tracker.

- Keep one concise, current, kebab-case note per topic under its owning area.
- Use path-qualified Foam links and cross-link instead of duplicating content.
- Add new notes to their area index and new areas to `wiki/index.md`.
- Record durable decisions, rationale, gotchas, WebGPU pitfalls, and API notes
  that future contributors would otherwise have to rediscover.

[#decision-gate|decision gate]: wiki/requirements/product-scope.md#decision-gate
[architecture/api-design|API design north star]: wiki/architecture/api-design.md
[engineering/benchmarks|Benchmarks]: wiki/engineering/benchmarks.md
[engineering/pre-commit-hooks|pre-commit hooks]: wiki/engineering/pre-commit-hooks.md
[engineering/state-invariants|invariant-driven state design]: wiki/engineering/state-invariants.md
[operations/ci-authority|CI authority]: wiki/operations/ci-authority.md
[requirements/product-scope|product scope and requirements contract]: wiki/requirements/product-scope.md
