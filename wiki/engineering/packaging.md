# Packaging

How femgx is built and shipped as an npm library, and the guarantees the
published package makes to consumers. See also
[[engineering/typescript-toolchain-compatibility|TypeScript toolchain compatibility]] and
[[engineering/scaffold-decisions|Scaffold decisions]].

## Build output

`npm run build` (typecheck + `vite build`) emits into `dist/`:

- `dist/femgx.js` and `dist/femgx.cjs` — canonical ESM/CommonJS bundles.
- `dist/{model,io,camera,runtime,platform}.js` and `.cjs` — explicit domain
  bundles; `dist/io/glb.js` and `.cjs` own the optional GLB importer.
- `dist/**/*.d.ts` and `dist/cjs/**/*.d.cts` — per-module declarations plus
  entry declarations used by the exports map.

`vite-plugin-dts` is configured with two out dirs (`dist` and `dist/cjs`, the
latter with `moduleFormat: "cjs"`). Demo fixtures live under `demo/fixture/`
and are outside the library entry, so they never ship.

### Declaration extension rewriting

Relative specifiers inside the emitted declarations must carry the right
extension for the resolution mode:

- `.d.ts` (ESM): `'./scene/assembly'` → `'./scene/assembly.js'`, so
  `moduleResolution: nodenext` accepts the package. Consumers under `bundler`
  and legacy `node10` resolution also accept the `.js` form.
- `.d.cts` (CJS): `'./scene/assembly.js'` → `'./scene/assembly.cts'`, because
  nodenext rejects both extensionless and `.js` specifiers in `.d.cts`.

This is implemented in `vite.config.ts` with a `beforeWriteFile` hook. Verified
by `scripts/package-smoke.mjs` under `bundler`, `nodenext`, and `node10`.

## Exports map

```json
"exports": {
  ".": { "import": { "types": "./dist/entries/root.d.ts", "default": "./dist/femgx.js" }, "require": { "types": "./dist/cjs/entries/root.d.cts", "default": "./dist/femgx.cjs" } },
  "./model": { "import": { "types": "./dist/model.d.ts", "default": "./dist/model.js" }, "require": { "types": "./dist/cjs/model.d.cts", "default": "./dist/model.cjs" } },
  "./io": { "import": { "types": "./dist/io.d.ts", "default": "./dist/io.js" }, "require": { "types": "./dist/cjs/io.d.cts", "default": "./dist/io.cjs" } },
  "./io/glb": { "import": { "types": "./dist/io/glb.d.ts", "default": "./dist/io/glb.js" }, "require": { "types": "./dist/cjs/io/glb.d.cts", "default": "./dist/io/glb.cjs" } },
  "./camera": { "import": { "types": "./dist/camera.d.ts", "default": "./dist/camera.js" }, "require": { "types": "./dist/cjs/camera.d.cts", "default": "./dist/camera.cjs" } },
  "./runtime": { "import": { "types": "./dist/runtime.d.ts", "default": "./dist/runtime.js" }, "require": { "types": "./dist/cjs/runtime.d.cts", "default": "./dist/runtime.cjs" } },
  "./platform": { "import": { "types": "./dist/platform.d.ts", "default": "./dist/platform.js" }, "require": { "types": "./dist/cjs/platform.d.cts", "default": "./dist/platform.cjs" } },
  "./package.json": "./package.json"
}
```

The nested per-condition `types` lets CJS consumers get `.d.cts` while ESM
consumers get `.d.ts`, so each format is type-checked against its own tree.
`sideEffects: false` is set so bundlers can tree-shake. The root and all
non-GLB entries have no GLB/Draco closure; only `femgx/io/glb` includes it.

## `@webgpu/types` is a devDependency only

TypeScript 6 ships WebGPU globals in `lib.dom.d.ts`, so the emitted declarations
reference no package that consumers must install:

- All GPU types used in the public `.d.ts` files (`GPUDevice`,
  `GPUPowerPreference`, `GPUCANvasContext`, …) resolve from the consumer's
  `lib.dom`.
- `@webgpu/types` stays a devDependency: the _source_ still needs its value
  namespaces (`GPUBufferUsage`, `GPUTextureUsage`, `GPUMapMode`,
  `GPUShaderStage`) and constants, which `lib.dom` does not declare.
- Shipping `@webgpu/types` as a dependency would double-declare the WebGPU
  globals and break strict consumers (`skipLibCheck: false`). Consumers need
  TypeScript ≥ 6 so their DOM lib includes the WebGPU types.

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
   tarball, failing on
   any finding. This catches hazards the bespoke checks do not, notably
   masquerading as CJS/ESM, wrong `types`-condition placement, and per-condition
   `.d.ts`/`.d.cts` resolution edge cases across every modern
   `moduleResolution` mode. The package reports "No problems found"; the
   explicit legacy node10 subpath no-resolution limitation is ignored because
   node10 cannot interpret package `exports`, while the root-only node10 smoke
   remains required.
3. Installs the tarball with lifecycle scripts, audit, funding, lockfile
   generation, registry access, and inherited npm configuration disabled, using
   a second temporary cache and empty user config.
4. Asserts the installed manifest has no runtime deps, is not private, and has
   no `preinstall`.
5. Runs `node` ESM `import` and CJS `require` of the root and every domain entry.
6. Type-checks all entries under `bundler` and `nodenext` (`.mts` + `.cts`),
   plus the canonical root under legacy `node10`, with `skipLibCheck: false`.

`npm publish` runs `test:package` automatically via `prepublishOnly`. attw is a
devDependency only (`@arethetypeswrong/cli`), so the published package and the
clean consumer never see it.

## Publish checklist

- [ ] `npm run format`, `npm run lint`, `npm run typecheck`, `npm test`
- [ ] `npm run build`
- [ ] `npm run test:package`
- [ ] `npm publish` (tags via `npm version`, semver; experimental product, so
      breaking changes are fine — see AGENTS.md)

[engineering/scaffold-decisions|Scaffold decisions]: scaffold-decisions.md
[engineering/typescript-toolchain-compatibility|TypeScript toolchain compatibility]: typescript-toolchain-compatibility.md
