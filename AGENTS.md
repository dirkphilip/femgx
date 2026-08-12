# AGENTS.md

## Experimental Status

This is an **experimental product** (version 0.1.0). There is **no stable API**:
we do not care about breaking API changes. The only thing that matters is shipping a
very clean product. Prefer improving the design over preserving backwards compatibility.

## Product Contract

The authoritative scope decision is [[requirements/product-scope|Product scope and
requirements contract]]. Read it before starting any task; this section is the short form.

### Core requirements

- **WebGPU-only rendering.** A modern WebGPU browser is the only supported
  rendering target. There is no CPU renderer, no hidden capability-probe canvas,
  and no fallback-driven device-recovery switching in the library or the demo: a
  missing/failed WebGPU device produces a typed unsupported result or a clear
  error, never a second renderer. Capability probing (`queryWebGpuSupport`) and
  device-loss recovery (`recover()`) are retained as supported-path features of
  the WebGPU contract (see [[rendering/platform-support|Platform support]]).
- **Parts, assemblies, instancing, visibility, camera, picking, interaction.**
  Reusable part geometry is drawn once and instanced across hierarchical
  assembly placements, including repeated placements of one reusable assembly
  definition. GPU picking (`FemViewport.pick`) returns host-mappable
  part/instance/element/face/node ids; selection/highlight/hover and hide/show
  are driven by per-instance GPU attributes, not CPU material clones.
- **Readable node annotations.** FE node glyphs respect scene depth: nearer
  faces hide occluded samples, while translucent 6 CSS-px front circles (scaled
  by `devicePixelRatio`) preserve the underlying surface. Dense overlaps must
  not accumulate toward black, and visibility must not depend on a geometric
  depth offset or zoom level.
- **Linear elements.** Points, lines, triangles, quads, Tet4, Hex8 with
  canonical topology and validated `createElement` construction.
- **Results.** Typed scalar/vector/tensor fields, derived quantities (magnitude,
  von Mises, principal values), value ranges, scalar color mapping, and
  deformed-shape geometry.
- **Box selection.** `installBoxSelection` remains a rectangle-only gesture,
  while `boxSelectionFrustum(camera, rect)` exposes six named normalized
  world-space planes for host-owned volume queries; this is separate from
  renderer culling.
- **IO.** A single FE interchange format (VTK legacy) with validation and
  diagnostics, plus the narrow bytes-only GLB 2.0 display-scene importer
  defined in [[requirements/product-scope|Product scope]]. GLB does not
  synthesize FE semantics.
- **Deterministic compile pipeline.** Iterative flattening and deterministic
  per-part batching with stable placement handles.

### Non-goals and deferred capabilities

The following are **not** requirements and must not be expanded as if they were:

- CPU fallback rendering (removed in #171; do not re-add a second renderer).
- Element families beyond Point, Line, Line3, Triangle, Quad, Tet4, Tet10,
  Hex8, and Hex20.
- Multi-hit pick lists (`pickMany`), adjacency inspection polish, and optional
  face display overlays.
- Advanced results playback (CasePlayer, interpolation) and legends
  (removed; do not re-add without an explicit product decision).
- IO adapters beyond VTK and the narrow GLB display-scene import (VTU, Gmsh,
  Abaqus, JSON glTF/external resources, GLB writing, cancellation, and
  progress) (removed or out of scope; do not broaden without an explicit
  product decision).
- Large-model streaming (spatial partitioning, LOD, upload budgets, worker
  parsing, coordinate rebasing) and the "hundreds of millions of elements"
  ambition (removed; do not re-add without an explicit product decision).

Existing code for deferred capabilities stays in the repository until an
explicit product decision removes it; new work must not grow it.

### Simplicity rules

- Prefer the smallest design that delivers the product value; **deletion-first**
  is the default stance.
- Do not add fallback branches, compatibility layers, optional modes, or new
  public API surface without an explicit requirement.
- Do not introduce parallel abstractions; extend an existing pattern when it
  covers the case.
- A successful implementation may delete code. Line count, module count, and
  abstraction count should not grow without justification.

### Decision gate for proposed additions

Any scope addition must answer, before work starts: (1) concrete user value,
(2) the minimum behavior that delivers it, (3) what existing code can be deleted
or simplified instead, (4) explicit non-goals, and (5) whether a new abstraction
is truly necessary. Work that grows scope without passing this gate is rejected.

## Project Overview

A TypeScript graphics library that renders finite-element (FE) models with
**WebGPU** and **GPU instancing**: geometry is uploaded once as a reusable
`Part` and drawn many times across `Assembly` placements, batching draws by part
to minimize pipeline changes. The authoritative CPU scene compiles into a packed
`SceneRuntime`; the renderer syncs per-frame deltas to per-instance GPU state.

## Source Organization

Implementation and tests are organized by subsystem so ownership boundaries are
obvious. Each subsystem is a directory under `src/` with a mirrored directory
under `test/`. Tags reflect the [[requirements/product-scope|product scope]]:

- `src/math/` — matrix/vector math (`mat4`). **Core.**
- `src/geometry/` — reusable part geometry, computed bounds, and element
  tessellation. **Core** for the supported linear and quadratic shapes.
- `src/elements/` — typed finite-element model: shape/topology definitions, a
  validated `createElement` constructor, and face/edge extraction. **Core for
  the supported linear and quadratic shapes.**
- `src/scene/` — authoritative CPU model: part/assembly/instance identities,
  assemblies, and the scene builder. **Core.**
- `src/scene-runtime/` — packed CPU-side scene runtime with delta-oriented
  visibility updates (`createSceneRuntime`). **Core.**
- `src/camera/` — immutable orbit camera and projection math. **Core.**
- `src/interaction/` — centralized highlight/selection/hover/override state.
  **Core.**
- `src/results/` — typed result fields, derived quantities, value ranges,
  scalar color mapping, and deformed-shape geometry. **Core.**
- `src/io/` — versioned FE interchange model, VTK legacy read/write, the
  bytes-only GLB display-scene importer, and shared validation/diagnostics.
  **Core.**
- `src/picking/` — GPU pick-id resolution (`resolvePick` / `resolvePickTarget`)
  for part/instance/element/face/node targets. **Core** (CPU raycast stack
  removed; multi-hit `pickMany` is future).
- `src/platform/` — WebGPU device request and loss reporting with typed
  unsupported reasons, plus capability probing (`queryWebGpuSupport`) and
  supported-path device recovery. **Core.**
- `src/renderer/` — WebGPU renderer, shaders, and GPU buffer support. **Core.**
- `src/viewport/` — canonical scene/runtime/camera/renderer/controls lifecycle facade. **Core.**

Conventions:

- New domain code belongs in the owning subsystem directory. Keep modules
  focused; treat 300 implementation lines as a review threshold and 400 as the
  hard limit. Split a module when doing so improves cohesion, not merely to
  satisfy a line count.
- The single public entry point is `src/index.ts`; anything it does not
  re-export is internal. Subsystem directories expose only deliberate public
  boundaries — do not widen the API surface by exporting internals from a new
  location.
- `test/` mirrors source ownership for product subsystems, while deliberate
  repository-level suites also live under `test/demo`, `test/public-api`,
  `test/runtime`, `test/scripts`, and `test/supervisor`.
- Prefer intra-subsystem imports. `src/index.ts` is the external and demo
  consumer boundary; production modules must use the owning subsystem's
  exported surface and must not import the root barrel.

The demo is split by ownership: `demo/workbench/` contains user-facing
inspection behavior and DOM lifecycle, `demo/devtools/` contains diagnostics
formatting and the typed browser-test harness, and `demo/benchmark/` contains
the opt-in WebGPU benchmark plus its narrowly permitted internal imports.

## Public API North Star

The canonical public workflow is reusable part definitions and assembly
placements registered in a `Scene`, compiled into one `SceneRuntime`, and
consumed by `FemViewport`. Preserve the semantic distinction between part
definitions, part instances, assembly definitions, registries, and runtime
slots; see [[architecture/api-design|API design north star]].

- Reusable geometry is defined once and referenced by instances; placements do
  not copy geometry.
- The authoritative CPU scene owns model data. Packed runtime arrays and GPU
  buffers are derived representations.
- Runtime slots, draw-order buffers, GPU record layouts, and storage capacities
  are implementation details, not default root-level API concepts.
- Every new public concept needs a clear owner, identity/data-ownership story,
  place in the canonical flow, end-to-end example, and API-level test — and must
  pass the [[#decision-gate-for-proposed-additions|decision gate]].

## Engineering Standards

This project is built primarily by AI agents. Setup must make agent-driven changes safe
and reviewable.

- **Language**: Modern TypeScript with `strict: true`. Prefer explicit types,
  `satisfies`, readonly, const objects, and definite assignment — no `any` where
  avoidable. Favor functional style (pure functions, immutable updates) for the CPU-side
  scene/state model.
- **Build**: Modern bundler (Vite) with library mode for the published API plus a
  demo/dev app.
- **Formatting**: Prettier with a committed config; run it after edits.
- **Linting**: ESLint flat config with `typescript-eslint` recommended + strict rulesets
  (`strict-type-checked`), plus extra strictness (no-unused-vars, no-explicit-any,
  consistent-type-imports). Lint must pass before any PR.
- **Type checking**: `tsc --noEmit` with strict settings must be clean before any PR.
- **Tests**: Unit tests for the CPU-side scene/assembly/picking logic (no GPU needed).
  Keep WebGPU code behind thin interfaces so it can be tested/mocked. Vitest with
  enforced v8 coverage thresholds (lines/functions 80%, branches 70%). Playwright
  e2e tests cover the WebGPU demo contract against a local dev server.
- **Docs**: Document the public API surface (typedoc or JSDoc on exported symbols).
- **Small modules**: ESLint enforces a 400-line implementation-file ceiling;
  300 lines is a review threshold. Per-function length remains 60 lines and
  nesting depth remains 4. Split large modules when that produces clearer
  single-concern boundaries.
- **[[engineering/state-invariants|Invariant-driven state design]]**: validate
  runtime values at public, untrusted, and ownership boundaries when types
  cannot express the constraint; keep practical transitions pure and immutable,
  preserve documented invariants, and test forbidden, boundary, inverse, and
  round-trip paths. Do not scatter duplicate internal assertions or silently
  normalize invalid state unless normalization is the documented boundary
  contract.
- **CI**: GitHub Actions runs the full quality gate (pre-commit hooks, format,
  typecheck, lint, unit tests + coverage, performance budgets, build, package smoke
  tests, e2e) on every push/PR. CI must be green before merge. Opt-in performance runs
  live in a separate `workflow_dispatch` workflow (see
  [[engineering/benchmarks|Benchmarks]]).

## Commands

These exist in `package.json`:

- Husky owns the git `pre-commit` hook slot. The hook runs `npm run pre-commit`
  (lint-staged's eslint `--fix` and prettier pass), then `pre-commit run` over
  the final staged snapshot. Contributors must install the `pre-commit` CLI;
  the hook reports the setup command when it is missing (see
  [[engineering/pre-commit-hooks|Pre-commit hooks]]).
- `.pre-commit-config.yaml` adds popular validators (YAML/JSON, large files,
  private keys, whitespace, EOF, and merge markers). CI independently runs
  `pre-commit run --all-files` on every push/PR, while `pre-commit run` remains
  the staged-file local check.
- `npm run dev` — dev server with demo app.
- `npm run build` — type-check + bundle library (emits `dist/` with `.d.ts`).
- `npm run test:package` — package smoke test: build, `npm pack`, install into a
  clean consumer, verify ESM/CJS runtime import/require and declaration
  resolution (see [[engineering/packaging|Packaging]]).
- `npm run typecheck` — `tsc --noEmit`.
- `npm run lint` — ESLint on the repository-owned code and configuration with
  `--max-warnings 0`, followed by the dependency-cruiser subsystem DAG gate.
- `npm run lint:fix` — ESLint with `--fix` on the same scope, followed by the
  dependency DAG gate.
- `npm run lint:dependencies` — dependency-cruiser validation of the production
  subsystem DAG, including type-only imports.
- `npm run format` — Prettier write on the whole repo.
- `npm run format:check` — Prettier check (agents should use `format`).
- `npm test` — Vitest unit tests (`test/**/*.test.ts`).
- `npm run test:watch` — Vitest watch mode.
- `npm run test:coverage` — unit tests with enforced v8 coverage thresholds.
- `npm run bench` — opt-in Vitest benchmark suite (`test/bench/*.bench.ts`).
- `npm run bench:budget` — deterministic performance budget gate; run standalone
  (coverage distorts timing) and enforced by CI (see
  [[engineering/benchmarks|Benchmarks]]).
- `npm run bench:webgpu` — opt-in system-Chrome WebGPU capacity benchmark;
  emits a machine-readable report and has no cross-device timing threshold.
- `npm run test:e2e` — full Playwright e2e against system Chrome (hardware
  WebGPU). Run locally; requires `npm run test:e2e:install`.
- `npm run test:e2e:ci` — CI-only no-GPU unsupported-contract smoke (no
  SwiftShader full suite; a GPU runner may host the full lane later).
- `npm run test:e2e:install` — install system Chrome + Playwright Chromium.
- `npm run preview` — preview the built demo.

During interactive development, agents must run:
`npm run lint`, `npm run typecheck`, `npm test`, `npm run bench:budget`, and
`npm run format`, and leave the repo clean. CI enforces the full gate
automatically on every push/PR (see `.github/workflows/ci.yml`).

## Agent Workflow Rules

- Read AGENTS.md (this file) and the
  [[requirements/product-scope|product scope]] and follow them on every change.
- Start every task with a requirement challenge: user value, minimum behavior,
  deletion candidates, non-goals, and whether a new abstraction is necessary.
- For interactive edits, run `npm run lint`, `npm run typecheck`, `npm test`,
  and format, then leave the repo clean.
- Keep changes small and reviewable; one logical change per PR/commit.
- Follow the existing file/type conventions — do not introduce parallel abstractions.
- Do not add comments to code unless they explain non-obvious design decisions.
- Update this file when the architecture or commands materially change.
- Before merging any rendering, camera, interaction, demo, CSS, or responsive-layout
  change, run the real system-Chrome WebGPU lane and inspect actual screenshots at
  both desktop and 390×844 mobile viewports. A submitted-frame counter, mocked GPU
  test, or no-GPU CI pass is not visual evidence; a black/blank canvas blocks merge.

## Clean Code as a First-Class Duty

The codebase must stay clean, not just correct. This is an explicit, ongoing duty:

- **Seek to simplify**: prefer the simplest design that satisfies the requirements.
  Delete dead code, remove unused abstractions, and resist speculative complexity.
- **Fix rendering failures at their source**: when a visual regression appears,
  inspect the renderer, shader, pipeline, camera, and geometry contracts before
  changing a demo fixture. Do not add duplicate faces, proxy volumes, or other
  fixture workarounds to conceal a rendering defect. In particular, linear 2D
  surfaces must remain inspectable from either side unless an explicit product
  requirement introduces an opt-in culling policy.
- **Refactor when it makes things much cleaner**: if restructuring a function, module, or
  type meaningfully improves clarity or reduces duplication, do it — even if it touches
  lines unrelated to the current change. Keep such refactors in their own commit so they
  stay reviewable.
- **Avoid parallel abstractions**: if an existing pattern covers a case, extend it; do not
  introduce a second, overlapping way of doing the same thing.
- **Deletion-first**: removing a subsystem or trimming a deferred capability behind an
  explicit product decision is good work, not a loss.
- **Leave the campsite cleaner than you found it**: tidy small messes encountered in
  passing (naming, formatting, obvious dead code) without waiting for a dedicated task.

## Surfacing Issues

Agents must actively report problems, not silently work around them:

- When you find a bug, a design smell, a performance risk, a scope expansion, or an
  inconsistency, **raise it** — don't bury it. Surface it in your response to the user
  and open or update the relevant GitHub issue.
- Prefer the smallest fix that resolves the issue; if a proper fix is out of scope, record
  it clearly in GitHub so it is not lost.
- Open questions and unresolved trade-offs belong in a GitHub issue and, when durable,
  in the owning wiki note—not only in chat.

## Internal Wiki (Knowledge Base)

Maintain an internal, plain-markdown wiki under `wiki/` using Foam wikilinks and
GitHub-compatible link-reference definitions so notes are linkable and navigable.
It is written for **both humans and future agents**: it is the project's durable
product and engineering memory, browseable in Foam or as GitHub-rendered Markdown.
GitHub issues and pull requests are the authoritative work tracker;
the wiki is not an implementation checklist or backlog mirror:

- **One markdown file per topic** (a design decision, a gotcha, an API note, an issue,
  a known limitation). Name files with `kebab-case` under the owning area, e.g.
  `wiki/architecture/instancing-strategy.md`.
- **Use path-qualified Foam links** such as `[[area/note|wiki-link]]` to reference related notes, and prefer cross-linking
  over duplicating content.
- **Maintain index files** at `wiki/index.md` and under each topical area; they list and
  link the notes so the wiki is navigable without a search tool. Add every new note to
  its area index and add every new area to the root index.
- Keep notes concise and current: update them when the relevant design changes, and retain
  resolved history only when it explains a durable decision or gotcha.
- Record: architecture decisions and rationale, scope classifications, issues/gotchas found,
  WebGPU/instancing pitfalls, API design notes, and anything a future agent would otherwise
  have to rediscover.

[#decision-gate-for-proposed-additions|decision gate]: AGENTS.md#decision-gate-for-proposed-additions
[architecture/api-design|API design north star]: wiki/architecture/api-design.md
[engineering/benchmarks|Benchmarks]: wiki/engineering/benchmarks.md
[engineering/packaging|Packaging]: wiki/engineering/packaging.md
[engineering/pre-commit-hooks|Pre-commit hooks]: wiki/engineering/pre-commit-hooks.md
[engineering/state-invariants|Invariant-driven state design]: wiki/engineering/state-invariants.md
[operations/ci-authority|CI authority]: wiki/operations/ci-authority.md
[rendering/platform-support|Platform support]: wiki/rendering/platform-support.md
[requirements/product-scope|product scope]: wiki/requirements/product-scope.md
