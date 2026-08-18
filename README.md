# FemGx

An experimental TypeScript library for rendering finite-element (FE) models
with **WebGPU** and **GPU instancing**.

FemGx lets applications define reusable parts, place them through hierarchical
assemblies, compile one scene, and render it through a single viewport
lifecycle. WebGPU is the only rendering backend; unsupported environments
receive a typed result or clear error, never a CPU renderer or compatibility
fallback.

**[Try the live workbench →](https://dirkphilip.github.io/femgx/)** ·
[Read the API reference](https://dirkphilip.github.io/femgx/api/)

## Status

Version 0.1.0 is an experimental release with no stable API. It supports the
core path from authored FE data to an instanced WebGPU viewport, including:

- reusable typed FE parts and compact host-reduced surface parts;
- hierarchical assemblies, stable occurrence identities, visibility, selection,
  hover, highlight, and picking;
- camera fitting and navigation, section planes, and a world-origin X/Y/Z
  orientation triad;
- authored nodal and elemental scalar results, nodal-vector deformation, and
  bounded elemental orientation glyphs; and
- host-supplied model validation/conversion and narrow, display-only GLB 2.0
  import.

FemGx does not derive engineering quantities, own result timelines, import GLB
materials/textures/animation, or provide a non-WebGPU renderer. See the
[product scope](wiki/requirements/product-scope.md) for the supported and
deferred boundaries.

## Installation

FemGx is not published to npm yet. Install a local package tarball while the
package is still experimental:

```sh
git clone https://github.com/dirkphilip/femgx.git
cd femgx
npm ci
npm run build
npm pack --ignore-scripts
```

The build creates the package output and `npm pack` creates
`femgx-0.1.0.tgz`. From your application directory, install that tarball:

```sh
npm install ../femgx/femgx-0.1.0.tgz
```

The package ships ESM and CommonJS builds with TypeScript declarations.
WebGPU types come from the TypeScript 6 DOM library; consumers do not need
`@webgpu/types`. Once FemGx is published, this section will switch to the
normal registry installation command.

## First render

The canonical flow is:

```text
reusable Part → hierarchical Assembly → Scene → Viewport
```

A part owns immutable local geometry. Assemblies place parts without copying
geometry. A scene owns those definitions and its root hierarchy. The viewport
compiles the scene into a packed runtime and owns WebGPU resources, interaction,
results, camera state, resize, recovery, and teardown.

For a complete, runnable browser example that creates a small typed FE plate,
adds a canvas, and calls `createViewport`, follow the [five-minute workflow in
the API reference](docs/api-reference.md#five-minute-workflow). The essential
application shape is:

```ts
import { createScene, createViewport, identity } from "femgx";
import { elementPart } from "femgx/model";

const part = elementPart(partId, model);
const scene = createScene()
  .addPart(part)
  .addAssembly({
    id: assemblyId,
    name: "root",
    placements: [{ kind: "part", partId: part.id, transform: identity() }],
  })
  .withRoot(assemblyId)
  .build();

const viewport = await createViewport({ canvas, scene });
viewport.view.fit();
```

The snippet shows the composition shape; `partId`, `model`, `assemblyId`, and
`canvas` are host-owned values. Use the linked workflow when you want code that
can be pasted directly into a browser module.

`createViewport()` requests a real WebGPU adapter and device. Use
`queryWebGpuSupport()` for a non-throwing capability probe before loading data.
Call `viewport.destroy()` when the host removes the canvas.

## Public entry points

Import the narrowest entry point for the domain you use:

| Import           | Use                                                                               |
| ---------------- | --------------------------------------------------------------------------------- |
| `femgx`          | Parts, scenes, viewport lifecycle, interaction, picking, results, and common math |
| `femgx/model`    | FE shapes/elements, model editing, `elementPart`, and `surfacePart`               |
| `femgx/io`       | FEM model validation, diagnostics, and authored-result conversion                 |
| `femgx/io/glb`   | Optional bytes-only GLB display-scene import                                      |
| `femgx/camera`   | Camera construction, fitting, projection, and navigation helpers                  |
| `femgx/runtime`  | Advanced standalone CPU scene-runtime inspection                                  |
| `femgx/platform` | Supported-path WebGPU adapter and device ownership                                |

For 0.x import changes, see the [entry-point migration map](docs/migration-0.x-entry-points.md)
and [viewport migration map](docs/migration-0.x-viewport.md).

## Supported environments and boundaries

- A modern browser with a working WebGPU implementation is required. There is
  no CPU rendering fallback.
- TypeScript 6.0+ is supported with `bundler`, `node16`, `nodenext`, or legacy
  `node10` module resolution.
- Node 24+ is required for repository tooling; the library is browser-first.
- GLB import accepts self-contained GLB 2.0 bytes for display geometry only.
  Textures, PBR materials, animation, lights, FE identities, external
  resources, unit conversion, and mesh compression remain outside that boundary.
- Results are authored scalar/vector snapshots. FemGx retains the current
  snapshot and does not interpolate time steps or derive stress, magnitude, or
  other engineering values.

## Documentation

- [API reference and five-minute workflow](docs/api-reference.md)
- [Architecture and API design](wiki/architecture/api-design.md)
- [Product scope and requirements](wiki/requirements/product-scope.md)
- [Contributing and repository development](CONTRIBUTING.md)
- [Internal wiki](wiki/index.md)
