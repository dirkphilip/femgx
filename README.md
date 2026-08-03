# FE Mesh GPU (femgx)

A TypeScript graphics library for rendering very large finite element (FE) models at
interactive frame rates using **WebGPU** and **GPU instancing**.

## Goals

- Draw geometry once as a **Part** and reuse it across hierarchical **Assembly** placements.
- Batch repeated geometry by part and keep per-instance work proportional to state changes.
- Provide highlight, selection, hide/show, and GPU-based picking without material clones.

## Status

This experimental product has a working CPU scene foundation, WebGPU renderer, and
interactive CPU fallback: validated hierarchies, column-major transforms, stable placement
handles, deterministic batching and frustum culling, centralized interaction styles,
camera controls, asynchronous GPU picking, and a runnable demo.

## Architecture

- **Parts** own immutable drawable geometry and bounds; they never own world transforms.
- **Assemblies** place parts and nested assemblies with hierarchical transforms.
- **Instances** carry transforms, styles, and stable placement handles into GPU batches.
- The renderer uploads part geometry once, draws instances grouped by part, and keeps picking
  in a separate integer render pass.

Design decisions, gotchas, and open issues live in [`wiki/`](wiki/index.md).
The development workflow is documented in [`wiki/development-loop.md`](wiki/development-loop.md).

## Development

Commands:

- `npm run dev` — dev server with demo app
- `npm run build` — type-check and bundle the library with declarations
- `npm run typecheck` — strict TypeScript check
- `npm run lint` — ESLint with zero warnings
- `npm run lint:fix` — ESLint autofix
- `npm run format` — Prettier write
- `npm run format:check` — Prettier check
- `npm test` — Vitest unit tests
- `npm run test:watch` — Vitest watch mode
- `npm run test:coverage` — unit tests with enforced v8 thresholds
- `npm run test:e2e` — Playwright demo tests
- `npm run test:e2e:install` — install Playwright Chromium
- `npm run preview` — preview the built demo

Use Node 24 or newer; `.nvmrc` matches the CI runtime.

## Public API highlights

- `createScene()` validates duplicate IDs, missing references, invalid roots, and cycles.
- `flattenAssembly()` is iterative and returns a compact draw index plus a stable `instanceId`.
- `compileScene()` produces deterministic visible instances, culling, and reusable-part batches.
- `createInteractionState()` manages selection, highlight, hover, and style overrides.
- `createCamera()` supports perspective/orthographic projection, orbit, pan, zoom, and resize.
- `createWebGpuRenderer()` uploads geometry once, renders instanced batches, applies styles,
  and exposes asynchronous `pick(x, y)` readback.

This repository is developed with an Agent Supervisor workflow; see
[`wiki/supervisor-workflow.md`](wiki/supervisor-workflow.md).
