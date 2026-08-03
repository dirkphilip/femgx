---
name: clean-modules
description: Keep femgx source files small and clearly modular. Use when creating or editing src files, when a module grows past the size limits, or when deciding whether to split logic into a new module.
---

# Clean Modules

femgx enforces small files and clear module boundaries via ESLint:

- `max-lines`: 300 non-blank, non-comment lines per file (`src/**/*.ts`).
- `max-lines-per-function`: 60 lines per function.
- `max-depth`: 4 nesting levels.
- `max-params`: 5 parameters.

These are **errors** in `src/`, enforced by `npm run lint`.

## When to split

- A module exceeds the size limits → extract a focused module.
- A file mixes concerns (e.g. scene model + flattening + picking) → separate.
- A type is only used by one consumer → move it next to that consumer.

## Conventions

- One concept per module; a module should read like a short table of contents.
- Functional style: pure functions, immutable updates for the CPU-side model.
- Re-export public API from `src/index.ts`; keep internal helpers unexported.
- Type-only imports use `import type` (enforced by lint).

## Verify

```sh
npm run lint
npm run typecheck
npm test
```
