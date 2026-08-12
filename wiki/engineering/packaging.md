# Packaging

How femgx is built and shipped as an npm library, and the guarantees the
published package makes to consumers. See also
[[engineering/typescript-toolchain-compatibility|TypeScript toolchain compatibility]] and
[[engineering/scaffold-decisions|Scaffold decisions]].

## Build output

`npm run build` (typecheck + `vite build`) emits into `dist/`:

- `dist/femgx.js` — ESM bundle (`"module"` / `import` condition).
- `dist/femgx.umd.cjs` — UMD/CommonJS bundle (`"main"` / `require` condition).
- `dist/**/*.d.ts` — per-module ESM declarations, re-exported by `dist/index.d.ts`.
- `dist/cjs/**/*.d.cts` — CommonJS declarations, re-exported by
  `dist/cjs/index.d.cts`.

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
  ".": {
    "import": { "types": "./dist/index.d.ts", "default": "./dist/femgx.js" },
    "require": { "types": "./dist/cjs/index.d.cts", "default": "./dist/femgx.umd.cjs" }
  },
  "./package.json": "./package.json"
}
```

The nested per-condition `types` lets CJS consumers get `.d.cts` while ESM
consumers get `.d.ts`, so each format is type-checked against its own tree.
`sideEffects: false` is set so bundlers can tree-shake.

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
- No `preinstall` hook in the published manifest — `scripts/check-node-version.mjs`
  is a dev-repo preflight only (`predev`, `prebuild`, …), and a `preinstall`
  would fail for consumers who do not receive `scripts/`.

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
   masquerading as CJS/ESM (the UMD bundle sets `Symbol.toStringTag =
"Module"`), wrong `types`-condition placement, and per-condition
   `.d.ts`/`.d.cts` resolution edge cases across every `moduleResolution` mode.
   The package currently reports "No problems found"; there are no tolerated
   warnings, so the check is a hard gate (see `--ignore-rules` in attw if a
   known-benign rule ever needs to be waived).
3. Installs the tarball with lifecycle scripts, audit, funding, lockfile
   generation, registry access, and inherited npm configuration disabled, using
   a second temporary cache and empty user config.
4. Asserts the installed manifest has no runtime deps, is not private, and has
   no `preinstall`.
5. Runs `node` ESM `import` and CJS `require` of real APIs.
6. Type-checks a consumer `.ts` under `bundler`, `nodenext` (`.mts` + `.cts`),
   and `node10` resolution with `skipLibCheck: false`.

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
