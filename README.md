# FE Mesh GPU (femgx)

A TypeScript graphics library for rendering very large finite element (FE) models at
interactive frame rates using **WebGPU** and **GPU instancing**.

## Goals

- Draw geometry once (as a **Part**) and reuse it across many placements (**instances**)
  in a hierarchical **Assembly** tree, batching draw calls per part.
- Display models with hundreds of millions of elements without per-element geometry upload.
- Provide a clean, interactive API: **highlight**, **select**, and GPU-based **pick / hit
  testing** driven by per-instance GPU attributes.

## Status

Active development (experimental, no stable API). The TypeScript/WebGPU toolchain,
ESLint + typecheck, Vitest unit tests with enforced coverage, Playwright e2e, and CI are
all in place. See [AGENTS.md](AGENTS.md) for the engineering standards that govern
agent-driven development.

## Architecture

- **Parts** own a single set of drawable GPU resources (geometry, bounding volume) and
  are immutable once uploaded.
- **Assemblies** place parts in the scene via hierarchical transforms; each placement is
  an **instance**, enabling GPU instancing.
- The renderer batches draw calls per part and keeps instance data (transform, color,
  pick ID, visibility) in GPU buffers, so **highlight**, **selection**, **hide/show**, and
  GPU-based **picking** are driven by per-instance attributes rather than material clones.

## Wiki

Design decisions, gotchas, and open issues live in [`wiki/`](wiki/index.md)
(architecture overview, instancing strategy, interactive state, quality gate,
performance risks, engineering TODO, and more).

## Development

Commands (see `package.json`):

- `npm run dev` — dev server with demo app
- `npm run build` — type-check + bundle library (emits `dist/` with `.d.ts`)
- `npm run typecheck` — `tsc --noEmit`
- `npm run lint` — ESLint (`src`, `test`, `demo`, `e2e`, `--max-warnings 0`)
- `npm run lint:fix` — ESLint with `--fix`
- `npm run format` — Prettier write
- `npm run format:check` — Prettier check
- `npm test` — Vitest unit tests
- `npm run test:watch` — Vitest watch mode
- `npm run test:coverage` — unit tests with enforced coverage thresholds
- `npm run test:e2e` — Playwright e2e tests
- `npm run test:e2e:install` — install the Playwright Chromium browser
- `npm run preview` — preview the built demo

This repository is developed with an Agent Supervisor workflow; see
[`wiki/supervisor-workflow.md`](wiki/supervisor-workflow.md).
