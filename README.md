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

Early scaffolding. AGENTS.md describes the architecture and engineering standards for
agent-driven development; the build, lint, and test setup is being wired up next.

## Development

Planned commands (being scaffolded):

- `npm run dev` — dev server with demo app
- `npm run build` — type-check + bundle library
- `npm run typecheck` — `tsc --noEmit`
- `npm run lint` — ESLint
- `npm run format` — Prettier write
- `npm test` — unit tests
