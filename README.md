# FemGx

An experimental TypeScript library for rendering finite-element (FE) models
with **WebGPU** and **GPU instancing**.

FemGx defines reusable parts, places them through hierarchical assemblies,
compiles the authoritative CPU scene into one packed runtime, and renders it
through a single viewport lifecycle. WebGPU is the only rendering backend;
unsupported environments receive a typed result or clear error, never a CPU
renderer or compatibility fallback.

## Current state

Version 0.1.0 is intentionally unstable but implements the complete canonical
path:

- validated parts, assemblies, stable placements, structural scene updates,
  packed runtime queries, and instanced WebGPU drawing;
- typed FE authoring through `elementPart()` and compact host-reduced facets,
  lines, and points through `surfacePart()`;
- visibility, hover, highlight, selection, box-region picking, section planes,
  and stable part/instance/body/block/element/face/node/authored-edge identities;
- fitted orthographic or perspective cameras, standard mouse/touch controls,
  an optional view cube, and a renderer-owned world-origin X/Y/Z triad;
- authored nodal or elemental scalar fields, nodal-vector deformation, and
  bounded elemental orientation glyphs; and
- host-supplied serializable FE model validation/conversion plus self-contained
  GLB 2.0 display-scene import.

FemGx does not derive engineering quantities, own result timelines, import GLB
materials/textures/animation, or provide a non-WebGPU renderer. The authoritative
[product scope](wiki/requirements/product-scope.md) records the supported and
deferred boundaries.

## Architecture

- A **Part** owns immutable local geometry and FE metadata, never a world transform.
- An **Assembly** places parts and nested assemblies without copying geometry.
- A **Scene** owns the part and assembly registries plus the root hierarchy.
- A **SceneRuntime** is the derived packed CPU snapshot with stable host identities.
- **Viewport** owns the current runtime, WebGPU renderer, recovery, resize, and
  teardown; stable `view`, `interaction`, `visibility`, `results`, and
  `presentation` facades expose each host responsibility.

Geometry is uploaded once per part and drawn for each placement. Runtime slots,
GPU layouts, and renderer construction remain internal. See the
[API design](wiki/architecture/api-design.md), [wiki](wiki/index.md), and
[repository contract](AGENTS.md) for deeper design guidance.

## Installation

```sh
npm install femgx
```

The package ships ESM and CommonJS builds with TypeScript declarations. WebGPU
types come from the TypeScript 6 DOM library; consumers do not need
`@webgpu/types`.

Choose the narrowest entry point:

| Import           | Use                                                                           |
| ---------------- | ----------------------------------------------------------------------------- |
| `femgx`          | Parts, scenes, viewport lifecycle, interaction, picking, and authored results |
| `femgx/model`    | FE shapes/elements, model editing, `elementPart`, and compact `surfacePart`   |
| `femgx/io`       | FEM model validation, diagnostics, and authored-result conversion             |
| `femgx/io/glb`   | Optional bytes-only GLB display-scene import                                  |
| `femgx/camera`   | Custom camera shells and navigation helpers                                   |
| `femgx/runtime`  | Advanced CPU scene-runtime inspection                                         |
| `femgx/platform` | Supported-path WebGPU adapter and device ownership                            |

For direct 0.x import changes, see the
[entry-point migration map](docs/migration-0.x-entry-points.md).
For the viewport surface migration, see the
[capability migration map](docs/migration-0.x-viewport.md).

## Canonical workflow

Create or import a reusable part, place it in an assembly, build one scene, and
give that scene to `Viewport`:

```ts
import { createViewport, createScene, identity } from "femgx";
import { elementPart } from "femgx/model";

const part = elementPart(10, model);
const scene = createScene()
  .addPart(part)
  .addAssembly({
    id: 1,
    name: "model",
    placements: [{ kind: "part", partId: part.id, transform: identity() }],
  })
  .withRoot(1)
  .build();

const viewport = await createViewport({ canvas, scene });
viewport.interaction.set(interaction);
viewport.results.set({
  scalar: { field: stress },
  deformation: { field: displacement, scale: 1.5 },
});
viewport.presentation.setSectionPlane({ normal: [1, 0, 0], distance: 0 });
viewport.updateScene(nextScene);
viewport.destroy();
```

`createViewport()` is asynchronous because it requests a WebGPU adapter and
device. Use `queryWebGpuSupport()` when a host wants a non-throwing capability
probe. CPU scene construction, camera math, standalone `createSceneRuntime()`,
and identity resolution do not require a GPU.

`viewport.setScene()` replaces scene state and fits the new scene;
`viewport.updateScene()` is the transactional structural-update path that
preserves compatible camera, interaction, visibility, and result state. Re-read
`viewport.runtime` after either operation because it installs a new snapshot.

Picking is owned by `viewport.interaction`. `pick()` resolves the nearest
physical hit, while `pickRegion()` returns deterministic visible-region
interaction targets. Edge granularity uses occurrence-scoped authored topology;
tessellation diagonals are never interaction targets.

Results are exact authored snapshots. Repeated `viewport.results.set()` calls can present
a host-owned sequence, but FemGx retains only the current snapshot and does not
interpolate time steps or derive stress, magnitude, or other engineering values.

## Import paths

`femgx/io` owns the serializable `FemModel` staging, validation, model-to-part
conversion, and authored-result conversion boundaries. The inspection demo's
**Open model…** action accepts self-contained `.glb` display scenes; local FE
authoring remains an in-memory host responsibility.

`femgx/io/glb` accepts GLB bytes, preserves numeric glTF coordinates, and returns
a canonical scene plus presentation metadata. GLB remains display-only: textures,
UVs, normals, animation, lights, FE identities, external resources, unit
conversion, and mesh compression are outside this importer.

## Supported environments

- **Browser:** a modern browser with a working WebGPU implementation.
- **TypeScript:** 6.0+ with `bundler`, `node16`, `nodenext`, or legacy `node10`
  module resolution.
- **Tooling:** Node 24+; `.nvmrc` matches CI. The library is browser-first.

## Development

Install dependencies with `npm ci`. The main local commands are:

| Command                       | Purpose                                                   |
| ----------------------------- | --------------------------------------------------------- |
| `npm run dev`                 | Run the inspection demo                                   |
| `npm run build`               | Type-check and build the package with declarations        |
| `npm run build:demo`          | Build the static demo                                     |
| `npm run build:docs`          | Generate the experimental API reference                   |
| `npm run typecheck`           | Run strict TypeScript checks                              |
| `npm run lint`                | Run repository, ESLint, public-doc, and dependency checks |
| `npm run lint:markdown`       | Check local Markdown and Foam links                       |
| `npm run lint:styles`         | Check CSS and Svelte component styles                     |
| `npm run lint:wgsl`           | Validate composed WGSL offline with Naga                  |
| `npm run lint:package`        | Validate package metadata with Publint                    |
| `npm run lint:dead-code`      | Check files and dependency wiring with Knip               |
| `npm run format:check`        | Check Prettier formatting                                 |
| `npm run review:diff`         | Review the change for growth and weakened tests           |
| `npm test`                    | Run the normal Vitest suite                               |
| `npm run test:core`           | Run core tests without demo/WebGPU/benchmark suites       |
| `npm run test:coverage`       | Run unit coverage with enforced thresholds                |
| `npm run test:package`        | Smoke-test a clean consumer installation                  |
| `npm run bench:budget`        | Run fast CI performance budgets and scaling checks        |
| `npm run bench:scaling:large` | Opt-in 13k/43k/104k Hex8 core-API scaling proof           |
| `npm run test:e2e`            | Run serialized system-Chrome hardware-WebGPU journeys     |
| `npm run test:e2e:no-gpu`     | Verify the typed unsupported-WebGPU contract              |
| `npm run test:e2e:layout`     | Run focused desktop and phone layout checks               |
| `npm run bench:webgpu`        | Run the opt-in real-WebGPU browser performance report     |
| `npm run test:e2e:install`    | Install Playwright's branded Chrome                       |

The normal test and budget lanes remain short. The 100k-element scaling proof
generates its mesh outside the timed region and is intentionally excluded from
`npm test`, coverage, and CI. Performance methodology and covered workloads are
documented in [Benchmarks](wiki/engineering/benchmarks.md).

The demo and API reference are published from `main` at
<https://dirkphilip.github.io/femgx/> and
<https://dirkphilip.github.io/femgx/api/>.
