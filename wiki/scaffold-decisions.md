# Scaffold decisions

Recorded decisions from the initial toolchain setup.

## Toolchain

- Vite 8 library mode + `vite-plugin-dts` for `.d.ts` emission; demo app in
  `demo/` served by `index.html`.
- TypeScript 5.9 with strict flags: `noUncheckedIndexedAccess`,
  `noImplicitOverride`, `exactOptionalPropertyTypes`, `noUnusedLocals/Parameters`,
  `noPropertyAccessFromIndexSignature`, `verbatimModuleSyntax`.
- ESLint flat config: `typescript-eslint` `recommendedTypeChecked` +
  `strictTypeChecked`, `@eslint/js`, `eslint-plugin-jsdoc`. Extra strictness:
  `consistent-type-imports`, `no-explicit-any`, `no-non-null-assertion`,
  `no-confusing-void-expression`. `--max-warnings 0`.
- Prettier (printWidth 100, trailingComma all), `.editorconfig`.
- Vitest 4 with v8 coverage thresholds (lines/functions 80, branches 70).

## Gotchas

- `typescript@7` is incompatible with `typescript-eslint` (peer range
  `<6.1.0`); pinned to `^5.9`.
- `noUncheckedIndexedAccess` applies to typed arrays too: reading
  `positions[i]` yields `number | undefined` and needs a fallback.
- JSDoc `require-param`/`require-returns` were disabled as redundant with strict
  TS types; `require-jsdoc` stays on for public functions/classes.

## Library structure

- `src/mat4.ts`, `src/types.ts`, `src/part.ts`, `src/assembly.ts`,
  `src/flatten.ts`, `src/scene.ts`, `src/pick.ts`, `src/index.ts` (public API).
- `test/` holds CPU-side unit tests; `demo/` a 2D canvas placeholder until the
  WebGPU renderer exists.

## Intentionally deferred

- WebGPU renderer, pipelines, buffers, picking GPU path.
- `@webgpu/types` is installed so renderer work can start anytime.
