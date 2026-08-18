# FemGx

An experimental TypeScript library for rendering finite-element (FE) models
with **WebGPU** and **GPU instancing**.

Define reusable FE parts, place them through hierarchical assemblies, and render
the compiled scene through one viewport lifecycle. FemGx is WebGPU-only:
unsupported environments receive a typed result or clear error, never a CPU
fallback.

**[Try the live workbench →](https://dirkphilip.github.io/femgx/)** ·
[Read the API reference](https://dirkphilip.github.io/femgx/api/)

## Get started

Version 0.1.0 is experimental and not yet published to npm. Build and install a
local package tarball:

```sh
git clone https://github.com/dirkphilip/femgx.git
cd femgx
npm ci
npm run build
npm pack --ignore-scripts
```

Then, from your application directory:

```sh
npm install ../femgx/femgx-0.1.0.tgz
```

FemGx ships ESM and CommonJS builds with TypeScript declarations. Applications
need a modern WebGPU browser. TypeScript 6.0 or newer includes the required
WebGPU types; TypeScript 5.9 applications must install them separately:

```sh
npm install --save-dev @webgpu/types
```

Add the package to the application's `tsconfig.json`:

```json
{
  "compilerOptions": {
    "types": ["@webgpu/types"]
  }
}
```

## First render

The canonical flow keeps reusable geometry separate from its placements:

```text
Part → AssemblyDefinition → Scene → Viewport
```

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

Here, `partId`, `model`, `assemblyId`, and `canvas` are host-owned values. The
[five-minute workflow](docs/api-reference.md#five-minute-workflow) provides a
complete, pasteable browser example and explains capability probing, interaction,
results, scene updates, and teardown.

## API model

| Concept              | Responsibility                                            |
| -------------------- | --------------------------------------------------------- |
| `Part`               | Immutable local geometry that can be placed many times    |
| `AssemblyDefinition` | A reusable hierarchy of part and assembly placements      |
| `Scene`              | The authoritative definitions and root assembly           |
| `Viewport`           | Rendering, camera, interaction, results, and GPU lifetime |

Use `replaceScene()` for a new model. Use `reconcileScene()` for structural
edits that should preserve compatible camera, interaction, visibility, and
result state. Re-read `viewport.runtime` after either operation because the
viewport installs a new compiled snapshot.

The primary entry points are:

| Import        | Use it for                                                  |
| ------------- | ----------------------------------------------------------- |
| `femgx`       | Scene composition, viewport lifecycle, interaction, results |
| `femgx/model` | FE elements, model editing, and part construction           |
| `femgx/io`    | FEM validation, diagnostics, and authored-result conversion |

Specialized entry points for camera math, runtime inspection, WebGPU device
ownership, and optional display-only GLB import are documented in the
[API reference](docs/api-reference.md). For 0.x import changes, see the
[entry-point migration map](docs/migration-0.x-entry-points.md) and
[viewport migration map](docs/migration-0.x-viewport.md).

## Scope

FemGx renders authored FE geometry, scalar results, nodal-vector deformation,
and bounded elemental orientation glyphs. It does not derive engineering
quantities, own result timelines, or provide a non-WebGPU renderer. See the
[product scope](wiki/requirements/product-scope.md) for the complete supported
and deferred boundaries.

## Documentation

- [API reference and five-minute workflow](docs/api-reference.md)
- [Architecture and API design](wiki/architecture/api-design.md)
- [Contributing and repository development](CONTRIBUTING.md)
