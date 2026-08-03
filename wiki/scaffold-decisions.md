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
- Vitest 4 with v8 coverage thresholds (lines/functions 80, branches 70),
  reporters `text`/`html`/`lcov` into `coverage/`.
- Playwright 1.x e2e tests in `e2e/` (Chromium) against the local Vite dev
  server (`npm run test:e2e`), with `test:e2e:install` for the browser.
- GitHub Actions CI (`.github/workflows/ci.yml`): format check, typecheck,
  lint, unit tests + coverage, build, and a separate Playwright e2e job.

## Gotchas

- `typescript@7` is incompatible with `typescript-eslint` (peer range
  `<6.1.0`); pinned to `^5.9`.
- `noUncheckedIndexedAccess` applies to typed arrays too: reading
  `positions[i]` yields `number | undefined` and needs a fallback.
- JSDoc `require-param`/`require-returns` were disabled as redundant with strict
  TS types; `require-jsdoc` stays on for public functions/classes.
- Size rules (`max-lines`, `max-lines-per-function`) are scoped to `src/` only;
  tests and the demo can be longer.
- `process.env` access in config files needs `process.env["KEY"]` form because
  of `noPropertyAccessFromIndexSignature`.

## Library structure

- Source and tests are organized by subsystem directories under `src/` and
  `test/` (math, geometry, scene, runtime, camera, interaction, picking,
  renderer); see [[source-organization|Source organization]].
- `src/index.ts` is the single public entry point; the demo app in `demo/` is an
  interactive canvas fallback that remains usable on browsers without WebGPU.
- `test/` holds CPU-side and mocked-WebGPU unit tests that mirror `src/`.

## Intentionally deferred

- Packed authoring storage, dirty-subtree propagation, benchmark budgets, and
  WebGPU-capable browser coverage.
- `@webgpu/types` supplies strict browser-side types for the renderer boundary.
