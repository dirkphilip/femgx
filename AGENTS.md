# AGENTS.md

## Experimental Status

This is an **experimental product** (version 0.0.0/0.0.1). There is **no stable API**:
we do not care about breaking API changes. The only thing that matters is shipping a
very clean product. Prefer improving the design over preserving backwards compatibility.

## Project Overview

A modern TypeScript graphics library that renders very large finite element (FE) models
efficiently using **WebGPU** and **GPU instancing**.

The goal is to display giant FE models (hundreds of millions of elements) at interactive
frame rates by drawing geometry once and reusing it across many instances.

## Core Concepts

### Parts

A **Part** is a reusable unit of drawable geometry:

- Owns a single set of GPU resources (vertex/index buffers, bounding volume).
- Does NOT own world transforms — it is the shared geometry that can be instanced many times.
- Has a stable identifier that the API can refer to (for selection, highlighting, styling).

### Assemblies

An **Assembly** is a hierarchical composition of parts and other assemblies:

- Places parts in the scene via transforms (local-to-parent or local-to-world).
- Each placement is an **instance** of a part → enables GPU instancing.
- Supports nested/hierarchical transforms (sub-assemblies) so large models can be
  organized the way FE tools organize them (e.g. model → subcase → part → element set).
- Supports **hide/show** at both part and assembly level; hiding an assembly hides all
  of its instances/sub-assemblies.

### Instancing Strategy

- Geometry that is repeated (identical meshes, common element shapes) is drawn once via
  instancing, with per-instance data (world transform, color, pick ID) in a GPU buffer.
- The renderer should batch draw calls by part to minimize pipeline/bind-group changes.
- Design so instance count is high and geometry upload is amortized — instancing is the
  core performance lever.

## API Requirements

The public API must be clean and ergonomic for interactivity:

- **Highlight** — per-part or per-instance style override (e.g. emissive/color) without
  touching the base material.
- **Selection** — maintain a set of selected parts/instances; the renderer renders them
  in a distinct state.
- **Hit testing / picking** — GPU-based picking (render instance IDs into a buffer and
  read back on pointer events) with a clean `pick(x, y)`-style API returning the
  part/instance under the cursor.
- **Hide/show** — toggling visibility on parts or assemblies (with hierarchy inheritance)
  must be cheap: it should update GPU state or instance counts directly, not rebuild
  buffers or touch materials.
- All interactive state (highlight/selection/hover/visibility) must be efficient: driven
  by per-instance attributes in GPU buffers, not by CPU-side material clones.

## Architecture Principles

- **Render Graph-ish separation**: a front-end scene/assembly model (CPU) is decoupled
  from a back-end GPU renderer. The scene is authoritative; the renderer syncs deltas.
- **Ownership boundaries**: Parts own geometry and are immutable once uploaded; Assemblies
  own the placement/hierarchy; the Renderer owns the device/swapchain/pipelines.
- **Async resource loading** and a deferred resource creation model (WebGPU requires
  device-queued creation of buffers/pipelines).
- **Deterministic ordering** of draw calls and instance data to keep frame-to-frame
  stability (important for picking consistency and diffs).
- **Efficient state management**: interactive state (highlight, selection, hover,
  visibility) is centralized and managed as deltas against the authoritative scene, not
  scattered one-off mutations. The scene flattens parts/assemblies into a deterministic
  instance list once; per-frame state changes only patch the affected instance attributes
  (color/emissive/pick/visibility) in the GPU buffer, or adjust instance counts, without
  rebuilding geometry or instance lists. Visibility is resolved bottom-up by hierarchy and
  culled instances at the source so hidden geometry is never drawn.

## Engineering Standards

This project is built primarily by AI agents. Setup must make agent-driven changes safe
and reviewable.

- **Language**: Modern TypeScript with `strict: true`. Prefer explicit types,
  `satisfies`, readonly, const objects, and definite assignment — no `any` where
  avoidable. Favor functional style (pure functions, immutable updates) for the CPU-side
  scene/state model.
- **Build**: Choose a modern bundler (Vite recommended) with library mode for the
  published API plus a demo/dev app for development.
- **Formatting**: Use Prettier with a committed config; agents must run it after edits.
- **Linting**: ESLint flat config with `typescript-eslint` recommended + strict rulesets
  (`strict-type-checked`), and enforce additional strictness (e.g. no-unused-vars,
  no-explicit-any, consistent-type-imports). Lint must pass before any PR.
- **Type checking**: `tsc --noEmit` with strict settings must be clean before any PR.
- **Tests**: Unit tests for the CPU-side scene/assembly/picking logic (no GPU needed).
  Keep WebGPU code behind thin interfaces so it can be tested/mocked.
- **Docs**: Document the public API surface (typedoc or JSDoc on exported symbols).

## Commands

These exist in `package.json`:

- `npm run dev` — dev server with demo app.
- `npm run build` — type-check + bundle library (emits `dist/` with `.d.ts`).
- `npm run typecheck` — `tsc --noEmit`.
- `npm run lint` — ESLint on `src/`, `test/`, `demo/` with `--max-warnings 0`.
- `npm run lint:fix` — ESLint with `--fix`.
- `npm run format` — Prettier write on the whole repo.
- `npm run format:check` — Prettier check (agents should use `format`).
- `npm test` — Vitest unit tests (`test/**/*.test.ts`).
- `npm run test:watch` — Vitest watch mode.
- `npm run preview` — preview the built demo.

After any edit, agents must run: `npm run lint`, `npm run typecheck`, `npm test`,
and `npm run format`, and leave the repo clean.

## Agent Workflow Rules

- Read AGENTS.md (this file) and follow it on every change.
- After any edit: run `npm run lint`, `npm run typecheck`, `npm test` (and format) and
  leave the repo clean.
- Keep changes small and reviewable; one logical change per PR/commit.
- Follow the existing file/type conventions — do not introduce parallel abstractions.
- Do not add comments to code unless they explain non-obvious design decisions.
- Update this file when the architecture or commands materially change.

## Clean Code as a First-Class Duty

The codebase must stay clean, not just correct. This is an explicit, ongoing duty:

- **Seek to simplify**: prefer the simplest design that satisfies the requirements.
  Delete dead code, remove unused abstractions, and resist speculative complexity.
- **Refactor when it makes things much cleaner**: if restructuring a function, module, or
  type meaningfully improves clarity or reduces duplication, do it — even if it touches
  lines unrelated to the current change. Keep such refactors in their own commit so they
  stay reviewable.
- **Avoid parallel abstractions**: if an existing pattern covers a case, extend it; do not
  introduce a second, overlapping way of doing the same thing.
- **Leave the campsite cleaner than you found it**: tidy small messes encountered in
  passing (naming, formatting, obvious dead code) without waiting for a dedicated task.

## Surfacing Issues

Agents must actively report problems, not silently work around them:

- When you find a bug, a design smell, a performance risk, or an inconsistency, **raise it**
  — don't bury it. Surface it in your response to the user and record it in the wiki
  (below).
- Prefer the smallest fix that resolves the issue; if a proper fix is out of scope, record
  it clearly so it is not lost.
- Open questions and unresolved trade-offs belong in the wiki, not only in chat.

## Internal Wiki (Knowledge Base)

Maintain an internal, plain-markdown wiki under `wiki/` using Foam/Obsidian-style
conventions so notes are linkable and navigable. It is written for **both humans and
future agents**: it is the project's living memory, browseable by anyone reading the repo
(open it as a Foam/Obsidian vault, or follow the index files in a plain editor):

- **One markdown file per topic** (a design decision, a gotcha, an API note, an issue,
  a known limitation). Name files with `kebab-case`, e.g. `wiki/instancing-strategy.md`.
- **Use `[[wiki-link]]` style links** to reference related notes, and prefer cross-linking
  over duplicating content.
- **Maintain index files** (e.g. `wiki/index.md`) that list and link the notes by topic
  area, so the wiki is navigable without a search tool. Add every new note to the index.
- Keep notes concise and current: update them when the relevant design changes, and mark
  resolved issues as resolved rather than deleting history silently.
- Record: architecture decisions and rationale, issues/gotchas found, WebGPU/instancing
  pitfalls, API design notes, and anything a future agent would otherwise have to rediscover.
