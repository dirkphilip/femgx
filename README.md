# FemGx

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
- `npm run build:docs` — generate and validate the experimental API reference under `dist-demo/api/`
- `npm run test:package` — package smoke test against a clean consumer install
- `npm run typecheck` — strict TypeScript check
- `npm run lint` — ESLint with zero warnings
- `npm run review:diff` — summarize changes and advisory source-directory review prompts
- `npm run lint:actionlint` — semantic GitHub Actions workflow validation
- `npm run lint:fix` — ESLint autofix
- `npm run format` — Prettier write
- `npm run format:check` — Prettier check
- `npm test` — Vitest unit tests
- `npm run test:watch` — Vitest watch mode
- `npm run test:coverage` — unit tests with enforced v8 thresholds
- `npm run test:e2e` — Playwright demo tests
- `npm run test:e2e:install` — install Playwright Chrome for the local WebGPU lane
- `npm run preview` — preview the built demo

The demo is deployed automatically to GitHub Pages on pushes to `main` by the
`Deploy demo to GitHub Pages` workflow. For a repository named `femgx` under the
`dirkphilip` account, its URL is <https://dirkphilip.github.io/femgx/>.
The generated API reference is at <https://dirkphilip.github.io/femgx/api/>.

Use Node 24 or newer; `.nvmrc` matches the CI runtime.

## Installation

```sh
npm install femgx
```

The package ships ESM and CommonJS builds plus TypeScript declarations for both.
The package includes the small glTF Transform runtime dependency used by the
bytes-only GLB display-scene importer. Consumers do **not** need
`@webgpu/types` (WebGPU types come from the TypeScript 6 DOM lib).

```js
// ESM
import { createScene, createFemViewport, createResultField, importGlb } from "femgx";
```

```js
// CommonJS
const { createScene, createFemViewport, createResultField, importGlb } = require("femgx");
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
- The CPU scene, camera, stable-handle runtime (`createSceneRuntime`), and
  interaction-target mapping (`interactionTargetFromHit`) are WebGPU-independent
  and work in any JavaScript environment. Public viewport picking (`pick` and
  `pickRegion`) requires a working WebGPU device.
- Interaction picking goes through `FemViewport`: asynchronous GPU readback via
  `viewport.pick(x, y)` returns a `Promise<PickHit | undefined>` with
  host-mappable part/instance/element/face/node ids, plus occurrence-scoped authored edge
  identities when requested with the `"edge"` granularity.

## Public API highlights

- `createScene()` validates duplicate IDs, missing references, invalid roots, and cycles.
- `createSceneRuntime()` is an advanced CPU-only, immutable compiled snapshot for
  stable-handle host queries; most hosts should let `createFemViewport()` own the
  current live runtime facade. Re-read `viewport.runtime` after `setScene()` or
  `updateScene()` because structural replacement installs a new query snapshot.
- `createInteractionState()` manages selection, highlight, hover, and style overrides.
- `InteractionTarget`, `setTargetSelected()`, and `setTargetHighlighted()` provide
  immutable dispatch for any part, instance, body, element, face, node, or authored-edge identity;
  `clearSelection()` preserves non-selection state.
- `createCamera()` defaults to orthographic projection and supports perspective as an explicit
  mode, plus orbit, pan, zoom, and resize.
- `installCameraControls()` adds the library's SpaceClaim-style mouse/touch behavior and
  renderer-owned rotation-origin axis widget without requiring the demo's tree, toolbar, or info panels.
- `createFemViewport()` is the canonical application path: it owns the packed runtime, fitted
  camera, renderer, controls, resize, interaction synchronization, recovery, and teardown.
- `createPart()` retains supplied typed arrays without copying and takes ownership of them; do
  not mutate or reuse those arrays after construction. For a mixed finite-element model, use
  `elementPart()` to compile one semantic reusable part with homogeneous primitive groups, then
  place that part once in an `Assembly`; the renderer keeps topology-specific draws internal.
- `createResultField()` builds typed nodal/elemental scalar and nodal vector fields; the
  results API maps authored scalar values, supports optional thresholds, and keeps
  authored nodal deformation on the existing GPU path with a configurable scale.

GLB is the narrow CAD display-scene import path. It accepts self-contained GLB 2.0 bytes,
preserves numeric glTF coordinates (glTF's meter convention is not converted), and returns the
canonical scene plus presentation metadata. Apply the returned part styles through the existing
interaction state before creating the viewport:

```ts
const imported = await importGlb(await file.arrayBuffer());
let interaction = createInteractionState();
for (const [partId, style] of imported.partStyles) {
  interaction = setPartOverride(interaction, partId, style);
}
const viewport = await createFemViewport({
  canvas,
  scene: imported.scene,
  interaction,
});
```

The library intentionally ignores textures, UVs, normals, PBR extras, animation, lights, and
FE semantics. Unsupported required extensions fail with `IoError`; optional ignored features are
reported in `imported.issues`. Mesh compression support is added only after a representative
compressed Onshape export identifies the extension and decoder.

The inspection demo's **Open model…** action accepts local ASCII legacy `.vtk` FE meshes and
self-contained `.glb` display scenes. VTK files use the canonical FE parser, mixed primitive
groups, and authored scalar/deformation result path; GLB files remain display-only.

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
const viewportContainer = document.querySelector<HTMLElement>("#viewport");
if (viewportContainer === null) throw new Error("Missing viewport container");
const viewport = await createFemViewport({
  canvas,
  scene,
  orientationGizmo: { container: viewportContainer },
  background: "studio",
});
viewport.setBackground("dark");
viewport.setInteraction(interaction);
viewport.setResults({
  scalar: { field: stress },
  deformation: { field: displacement, scale: 1.5 },
});
viewport.setPartVisible(part.id, false);
viewport.clearResults();
viewport.destroy();
```

`background` selects the renderer-owned WebGPU presentation (`"studio"`, `"white"`,
or `"dark"`); it defaults to `"studio"`. `setBackground()` changes that preset without
rebuilding the viewport or affecting depth, picking, interaction, or result rendering.

The renderer-owned world-origin X/Y/Z triad is enabled by default. Set
`originTriad: false` when creating a viewport to suppress it; the enabled triad
uses complete placed-scene bounds for its nominal size and caps projected axes at
56 CSS pixels.

`orientationGizmo` is optional. When enabled, femgx creates the accessible,
interactive view-cube SVG inside the supplied container. Its six named faces,
eight signed corners, four pitch/yaw arrows, and two clockwise/counterclockwise
roll arrows stay aligned with the viewport camera; all arrows step by 15° by
default, 90° with Shift, or 5° with Control/Command. It is removed when
`viewport.destroy()` runs. The container must contain the canvas; the caller
does not provide SVG markup.

Authored result snapshots use the same viewport and authoritative scene. Elemental scalar values
are colored directly while a nodal displacement field drives the existing GPU deformation path:

```ts
const stress = createResultField({
  id: "stress",
  name: "Stress",
  location: "elemental",
  shape: "scalar",
  count: elementCount,
  unit: "MPa",
  values: authoredScalarValues,
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
  scalar: { field: stress },
  deformation: { field: displacement, scale: 1.5 },
});
// Return to the base part styles and undeformed geometry.
viewport.clearResults();
```

Hosts may step or play an ordered collection of exact authored snapshots by calling
`setResults()` repeatedly. femgx installs each snapshot atomically and retains only the current
one; the host owns sequence metadata, timing, controls, and any shared scalar range. femgx does
not derive engineering quantities or temporally interpolate between snapshots.
