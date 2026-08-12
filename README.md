# FE Mesh GPU (femgx)

A TypeScript graphics library for rendering finite element (FE) models at
interactive frame rates using **WebGPU** and **GPU instancing**.

## Goals

- Draw geometry once as a **Part** and reuse it across hierarchical **Assembly** placements.
- Batch repeated geometry by part and keep per-instance work proportional to state changes.
- Provide highlight, selection, hide/show, and GPU-based picking without material clones.

## Status

This experimental product has a working CPU scene foundation and a WebGPU renderer:
validated hierarchies, column-major transforms, stable placement handles, deterministic
batching, centralized interaction styles, camera controls,
asynchronous GPU picking, and a runnable demo. WebGPU is the product's only rendering
backend; environments without a working WebGPU path get a clear error instead of a
fallback rendering path.

## Architecture

- **Parts** own immutable drawable geometry and bounds; they never own world transforms.
- **Assemblies** place parts and nested assemblies with hierarchical transforms.
- **Instances** carry transforms, styles, and stable placement handles into GPU batches.
- The renderer uploads part geometry once, draws instances grouped by part, and keeps picking
  in a separate integer render pass.

Design decisions, gotchas, and open issues live in [`wiki/`](wiki/index.md).
Repository contracts and the quality gate are documented in
[`AGENTS.md`](AGENTS.md) and [`wiki/engineering/quality-gate.md`](wiki/engineering/quality-gate.md).
The wiki uses Foam `[[wikilinks]]`; committed link-reference definitions keep
those links navigable in GitHub-rendered Markdown.

## Development

Commands:

- `npm run dev` — dev server with demo app
- `npm run build` — type-check and bundle the library with declarations
- `npm run build:demo` — type-check and build the demo as a static site
- `npm run test:package` — package smoke test against a clean consumer install
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

The demo is deployed automatically to GitHub Pages on pushes to `main` by the
`Deploy demo to GitHub Pages` workflow. For a repository named `femgx` under the
`dirkphilip` account, its URL is <https://dirkphilip.github.io/femgx/>.

Use Node 24 or newer; `.nvmrc` matches the CI runtime.

## Installation

```sh
npm install femgx
```

The package ships ESM and CommonJS builds plus TypeScript declarations for both.
There are no runtime dependencies. Consumers do **not** need `@webgpu/types`
(WebGPU types come from the TypeScript 6 DOM lib).

```js
// ESM
import { createScene, createFemViewport, createResultField } from "femgx";
```

```js
// CommonJS
const { createScene, createFemViewport, createResultField } = require("femgx");
```

## Supported environments

- **Browsers**: a modern browser with a working WebGPU implementation. Rendering
  requires WebGPU; the CPU scene, camera, packed runtime, and pick-id resolution
  APIs are WebGPU-independent, while renderer picking requires WebGPU. Unsupported
  environments receive an explicit unsupported/error result from the renderer.
- **TypeScript**: 6.0 or newer for consumers (declarations rely on DOM-lib WebGPU
  types). `moduleResolution: bundler`, `node16`, `nodenext`, and legacy `node10`
  resolution are all supported.
- **Node**: 24+ for tooling; the library is browser-first and has no Node-only
  runtime entry points.

### WebGPU capability behavior

- `createFemViewport(options)` is `async`: it checks `navigator.gpu`, requests an
  adapter and device, and throws a descriptive error when WebGPU is unavailable or
  the adapter/device request fails.
- `queryWebGpuSupport()` is a non-throwing probe that returns a typed
  "supported"/"unsupported" report for applications that want to branch up front.
- The CPU scene, camera, stable-handle runtime (`createSceneRuntime`), and pick-id
  resolution (`resolvePick` / `resolvePickTarget`) APIs are WebGPU-independent
  and work in any JavaScript environment. Viewport picking (`pick` and
  `pickPoint`) requires a working WebGPU device.
- Interaction picking goes through `FemViewport`: asynchronous GPU readback via
  `viewport.pick(x, y)` returns a `Promise<PickTarget | undefined>` with
  host-mappable part/instance/element/face/node ids.

## Public API highlights

- `createScene()` validates duplicate IDs, missing references, invalid roots, and cycles.
- `createSceneRuntime()` is an advanced stable-handle runtime boundary; most hosts
  should let `createFemViewport()` own the derived runtime.
- `createInteractionState()` manages selection, highlight, hover, and style overrides.
- `InteractionTarget`, `setTargetSelected()`, and `setTargetHighlighted()` provide
  immutable dispatch for any part, instance, body, element, face, or node identity;
  `clearSelection()` preserves non-selection state.
- `createCamera()` supports perspective/orthographic projection, orbit, pan, zoom, and resize.
- `installCameraControls()` adds the library's SpaceClaim-style mouse/touch behavior and
  renderer-owned rotation-origin axis widget without requiring the demo's tree, toolbar, or info panels.
- `createFemViewport()` is the canonical application path: it owns the packed runtime, fitted
  camera, renderer, controls, resize, interaction synchronization, recovery, and teardown.
- `createResultField()` builds typed nodal/elemental scalar, vector, and tensor fields; the
  results API adds derived quantities (magnitude, von Mises, principal values), value ranges,
  scalar color mapping with optional thresholds, and deformed-shape geometry with a
  configurable scale.

```ts
const scene = createScene()
  .addPart(part)
  .addAssembly({
    id: 1,
    name: "root",
    placements: [{ kind: "part", partId: part.id, transform: identity() }],
  })
  .withRoot(1)
  .build();
const viewport = await createFemViewport({ canvas, scene });
viewport.setInteraction(interaction);
viewport.setResults({
  field: stress,
  derive: "vonMises",
  deformation: { field: displacement, scale: 1.5 },
});
viewport.setPartVisible(part.id, false);
viewport.clearResults();
viewport.destroy();
```

Static results use the same viewport and authoritative scene. Elemental tensor values can be
derived and colored while a nodal displacement field drives the existing GPU deformation path:

```ts
const stress = createResultField({
  id: "stress",
  name: "Stress",
  location: "elemental",
  shape: "tensor",
  count: elementCount,
  unit: "MPa",
  values: stressValues,
});
const displacement = createResultField({
  id: "displacement",
  name: "Displacement",
  location: "nodal",
  shape: "vector",
  count: nodeCount,
  unit: "mm",
  values: displacementValues,
});
viewport.setResults({
  field: stress,
  derive: "vonMises",
  deformation: { field: displacement, scale: 1.5 },
});
// Return to the base part styles and undeformed geometry.
viewport.clearResults();
```
