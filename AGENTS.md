# AGENTS.md

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
- All interactive state (highlight/selection/hover) must be efficient: driven by
  per-instance attributes in GPU buffers, not by CPU-side material clones.

## Architecture Principles

- **Render Graph-ish separation**: a front-end scene/assembly model (CPU) is decoupled
  from a back-end GPU renderer. The scene is authoritative; the renderer syncs deltas.
- **Ownership boundaries**: Parts own geometry and are immutable once uploaded; Assemblies
  own the placement/hierarchy; the Renderer owns the device/swapchain/pipelines.
- **Async resource loading** and a deferred resource creation model (WebGPU requires
  device-queued creation of buffers/pipelines).
- **Deterministic ordering** of draw calls and instance data to keep frame-to-frame
  stability (important for picking consistency and diffs).

## Engineering Standards

This project is built primarily by AI agents. Setup must make agent-driven changes safe
and reviewable.

- **Language**: TypeScript with `strict: true` and no `any` where avoidable. Prefer
  explicit types, `satisfies`, and readonly where appropriate.
- **Build**: Choose a modern bundler (Vite recommended) with library mode for the
  published API plus a demo/dev app for development.
- **Formatting**: Use Prettier with a committed config; agents must run it after edits.
- **Linting**: ESLint with `typescript-eslint` recommended + strict rulesets.
- **Type checking**: `tsc --noEmit` must be clean before any PR.
- **Tests**: Unit tests for the CPU-side scene/assembly/picking logic (no GPU needed).
  Keep WebGPU code behind thin interfaces so it can be tested/mocked.
- **Docs**: Document the public API surface (typedoc or JSDoc on exported symbols).

## Commands (to be set up)

Ensure these exist in `package.json` and document exact usage here once scaffolded:

- `npm run dev` — dev server with demo app.
- `npm run build` — type-check + bundle library.
- `npm run typecheck` — `tsc --noEmit`.
- `npm run lint` — ESLint on `src/`.
- `npm run format` — Prettier write.
- `npm test` — unit tests.

## Agent Workflow Rules

- Read AGENTS.md (this file) and follow it on every change.
- After any edit: run `npm run lint`, `npm run typecheck`, `npm test` (and format) and
  leave the repo clean.
- Keep changes small and reviewable; one logical change per PR/commit.
- Follow the existing file/type conventions — do not introduce parallel abstractions.
- Do not add comments to code unless they explain non-obvious design decisions.
- Update this file when the architecture or commands materially change.
