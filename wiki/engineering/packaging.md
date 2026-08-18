# Packaging

How femgx is built and shipped as an npm library, and the guarantees the
published package makes to consumers. `package.json` and `package-lock.json`
are authoritative for toolchain versions and compatibility constraints.
The current TypeScript 6 pin also respects `typescript-eslint`'s `<6.1` peer
range; revisit it when the lint toolchain supports a newer compiler.

## Build output

`npm run build` (typecheck + `vite build`) emits into `dist/`:

- `dist/femgx.js` — canonical ESM bundle.
- `dist/{model,io,camera,runtime,platform}.js` — explicit domain bundles;
  `dist/io/glb.js` owns the optional GLB importer.
- `dist/**/*.d.ts` — per-module declarations plus entry declarations used by
  the exports map.

`vite-plugin-dts` emits declarations into `dist`. Demo fixtures live under
`demo/fixtures/` and are outside the library entry, so they never ship.

### Declaration extension rewriting

Relative specifiers inside emitted declarations carry `.js` extensions so
NodeNext consumers can resolve the ESM package:

- `'./scene/assembly'` → `'./scene/assembly.js'`.

This is implemented in `vite.config.ts` with a `beforeWriteFile` hook and
verified by `scripts/package-smoke.mjs` under `bundler` and `nodenext`.

## Exports map

```json
"exports": {
  ".": { "types": "./dist/entries/root.d.ts", "default": "./dist/femgx.js" },
  "./model": { "types": "./dist/entries/model.d.ts", "default": "./dist/model.js" },
  "./io": { "types": "./dist/entries/io.d.ts", "default": "./dist/io.js" },
  "./io/glb": { "types": "./dist/entries/io/glb.d.ts", "default": "./dist/io/glb.js" },
  "./camera": { "types": "./dist/entries/camera.d.ts", "default": "./dist/camera.js" },
  "./runtime": { "types": "./dist/entries/runtime.d.ts", "default": "./dist/runtime.js" },
  "./platform": { "types": "./dist/entries/platform.d.ts", "default": "./dist/platform.js" },
  "./package.json": "./package.json"
}
```

The `types` condition maps every ESM entry to its declaration file. There is no
`require` condition or CommonJS artifact; consumers import the package as ESM.
`sideEffects: false` is set so bundlers can tree-shake. The root and all
non-GLB entries have no GLB/Draco closure; only `femgx/io/glb` includes it.

## WebGPU types across TypeScript versions

TypeScript 6 ships WebGPU globals in `lib.dom.d.ts`, so the emitted declarations
reference no package that consumers must install:

- All GPU types used in the public `.d.ts` files (`GPUDevice`,
  `GPUPowerPreference`, `GPUCANvasContext`, …) resolve from the consumer's
  `lib.dom`.
- `@webgpu/types` stays a devDependency: the _source_ still needs its value
  namespaces (`GPUBufferUsage`, `GPUTextureUsage`, `GPUMapMode`,
  `GPUShaderStage`) and constants, which `lib.dom` does not declare.
- Shipping `@webgpu/types` as a dependency would double-declare the WebGPU
  globals and break strict TypeScript 6 consumers (`skipLibCheck: false`). It
  therefore remains a repository devDependency rather than a femgx dependency.
- TypeScript 5.9 consumers may install `@webgpu/types` themselves. The package
  smoke test compiles the packed public surface with that combination and
  `skipLibCheck: false`; TypeScript 6 remains the dependency-free path.

## Clean package guarantees

- `files: ["dist"]` — source, demo, tests, e2e, wiki, and `scripts/` are never
  packed; README and LICENSE are included automatically.
- No runtime `dependencies`; the published package installs with nothing extra.
- No `preinstall` hook or runtime dependency is introduced for the published
  package. `.nvmrc` selects the exact local development runtime,
  `devEngines.runtime` lets npm 11 enforce the repository's Node 24 boundary,
  and `engines.node` declares compatibility for package consumers.

## Smoke tests

`npm run test:package` is the single CI owner of the package build and smoke:

1. Builds exactly once, then runs `npm pack --ignore-scripts` with an explicit
   temporary cache, empty user config, quiet npm settings, and JSON output.
   The output must parse as exactly one result with a filename and files array;
   malformed or polluted output reports the command, status, stdout, and stderr.
2. Checks the tarball contents (declarations present, no source/demo/wiki
   leakage), then runs `@arethetypeswrong/cli` (attw) against the packed
   tarball, failing on any finding. This catches ESM declaration and
   `types`-condition resolution hazards the bespoke checks do not. Its expected
   CommonJS-to-ESM and legacy node10-resolution findings are ignored because
   CommonJS is unsupported.
3. Installs the tarball with lifecycle scripts, audit, funding, lockfile
   generation, registry access, and inherited npm configuration disabled, using
   a second temporary cache and empty user config.
4. Asserts the installed manifest has no runtime deps, is not private, and has
   no `preinstall`.
5. Runs `node` ESM `import` of the root and every domain entry.
6. Type-checks all entries under `bundler` and `nodenext` (`.mts`) with
   TypeScript 6 and `skipLibCheck: false`.
7. Type-checks the same packed public surface with TypeScript 5.9 and
   consumer-supplied `@webgpu/types`, also with `skipLibCheck: false`.

`npm publish` runs `test:package` automatically via `prepublishOnly`. attw is a
devDependency only (`@arethetypeswrong/cli`), so the published package and the
clean consumer never see it.

## Publish checklist

- [ ] `npm run format`, `npm run lint`, `npm run typecheck`, `npm test`
- [ ] `npm run build`
- [ ] `npm run test:package`
- [ ] `npm publish` (tags via `npm version`, semver; experimental product, so
      breaking changes are fine — see AGENTS.md)
