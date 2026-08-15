# Scaffold decisions

Recorded decisions from the initial toolchain setup.

## Toolchain

- Vite 8 library mode + `vite-plugin-dts` for `.d.ts` emission; demo app in
  `demo/` served by `index.html`.
- TypeScript 6.0.3 with strict flags: `noUncheckedIndexedAccess`,
  `noImplicitOverride`, `exactOptionalPropertyTypes`, `noUnusedLocals/Parameters`,
  `noPropertyAccessFromIndexSignature`, `verbatimModuleSyntax`.
- ESLint flat config: `typescript-eslint` `recommendedTypeChecked` +
  `strictTypeChecked`, `@eslint/js`, `eslint-plugin-jsdoc`. Extra strictness:
  `consistent-type-imports`, `no-explicit-any`, `no-non-null-assertion`,
  `no-confusing-void-expression`. `--max-warnings 0`.
- Prettier (printWidth 100, trailingComma all), `.editorconfig`.
- Vitest 4 with v8 coverage thresholds (lines/functions 80, branches 70),
  reporters `text`/`html`/`lcov` into `coverage/`.
- Playwright 1.x e2e tests in `e2e/` against the local Vite dev server
  (`npm run test:e2e`), with `test:e2e:install` for the local Chrome lane.
- GitHub Actions CI (`.github/workflows/ci.yml`): format check, typecheck,
  lint, unit tests + coverage, build, and a separate Playwright e2e job.

## Gotchas

- `typescript@7` is incompatible with `typescript-eslint` (peer range
  `<6.1.0`); pinned to `^6.0.3` (see
  [[engineering/typescript-toolchain-compatibility|TypeScript toolchain compatibility]]).
- `noUncheckedIndexedAccess` applies to typed arrays too: reading
  `positions[i]` yields `number | undefined` and needs a fallback.
- JSDoc `require-param`/`require-returns` were disabled as redundant with strict
  TS types; `require-jsdoc` stays on for public functions/classes.
- Size rules (`max-lines`, `max-lines-per-function`) are scoped to `src/` only;
  tests and the demo can be longer.
- `process.env` access in config files needs `process.env["KEY"]` form because
  of `noPropertyAccessFromIndexSignature`.
- `@webgpu/types` is a devDependency only: the source needs its value
  namespaces, but TS 6's DOM lib covers the WebGPU globals in emitted
  declarations (see [[engineering/packaging|Packaging]]).

## Library structure

- Source and tests are organized by subsystem directories under `src/` and
  `test/` (math, geometry, scene, runtime, camera, interaction, picking,
  renderer); see [[architecture/source-organization|Source organization]].
- `src/entries/` contains the package's explicit root and domain facades; the
  demo app in `demo/` is a thin WebGPU consumer that reports an explicit
  unsupported state on browsers without WebGPU.
- `test/` holds CPU-side and mocked-WebGPU unit tests that mirror `src/`.

## Intentionally deferred

- Packed authoring storage and dirty-subtree propagation remain future
  authoring optimizations; the shipped packed scene runtime and benchmark
  budgets are current engineering paths.

[architecture/source-organization|Source organization]: ../architecture/source-organization.md
[engineering/packaging|Packaging]: packaging.md
[engineering/typescript-toolchain-compatibility|TypeScript toolchain compatibility]: typescript-toolchain-compatibility.md
