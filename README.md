# FemGx

A strongly typed TypeScript library for rendering large, interactive
finite-element (FE) scenes with **WebGPU** and **GPU instancing**.

Define reusable FE parts, place them through hierarchical assemblies, and render
the compiled scene through one viewport lifecycle. FemGx is WebGPU-only:
unsupported environments receive a typed result or clear error, never a CPU
fallback.

**[Try the live workbench →](https://dirkphilip.github.io/femgx/)** ·
**[Explore the API →](https://dirkphilip.github.io/femgx/api/)**

> **Experimental 0.1.0** — the API is intentionally evolving toward the
> cleanest design and the package is not yet published to npm.

## Why FemGx

- **Instancing by design.** Define geometry once, then place it throughout a
  hierarchical assembly without copying model data.
- **FE-aware interaction.** Preserve occurrence-scoped element and authored-edge
  identities through picking, selection, visibility, and results.
- **One typed lifecycle.** A `Viewport` owns rendering, camera, interaction,
  results, device recovery, resize, and teardown.
- **Honest platform boundaries.** WebGPU support is explicit and typed, with no
  hidden CPU renderer or compatibility fallback.

## The core workflow

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

## Install locally

Until FemGx is published, build a package tarball from the repository:

```sh
git clone https://github.com/dirkphilip/femgx.git
cd femgx
npm ci
npm run build
npm pack --ignore-scripts
```

Then install the generated tarball from your application directory:

```sh
npm install ../femgx/femgx-0.1.0.tgz
```

FemGx ships ESM with declarations and requires a modern WebGPU browser.
TypeScript 6 includes WebGPU types; TypeScript 5.9 applications
also need `@webgpu/types` in `devDependencies` and `compilerOptions.types`.

## API model

| Concept              | Responsibility                                            |
| -------------------- | --------------------------------------------------------- |
| `Part`               | Immutable local geometry that can be placed many times    |
| `AssemblyDefinition` | A reusable hierarchy of part and assembly placements      |
| `Scene`              | The authoritative definitions and root assembly           |
| `Viewport`           | Rendering, camera, interaction, results, and GPU lifetime |

Use `replaceScene()` for an unrelated model. Use `updateScene()` for structural
edits that should preserve compatible camera, interaction, visibility, and
result state. Its synchronous transaction editor builds one validated immutable
snapshot without requiring the host to rebuild the complete scene:

```ts
viewport.updateScene((update) => {
  update.addPart(newPart);
  update.addPartOccurrence({
    assemblyId: rootAssemblyId,
    placementId: "new-part",
    partId: newPart.id,
    transform: identity(),
  });
});
```

Re-read `viewport.runtime` after a committed update or replacement because the
viewport installs a new compiled snapshot.

Visibility changes stay viewport-local and do not rebuild the scene. The
part-wide setter is a convenience policy keyed by reusable part id; it affects
every current and future occurrence without mutating the part or authored scene.
The bulk occurrence setter validates all ids before one atomic renderer sync:

```ts
viewport.visibility.setPart(partId, false);
viewport.visibility.setPartOccurrences(selectedPartOccurrenceIds, false);
```

The primary entry points are:

| Import              | Use it for                                                  |
| ------------------- | ----------------------------------------------------------- |
| `femgx`             | Scene composition and viewport lifecycle                    |
| `femgx/model`       | FE elements, model editing, and part construction           |
| `femgx/io`          | FEM validation, diagnostics, and authored-result conversion |
| `femgx/interaction` | Interaction state, selection, and host-owned gestures       |
| `femgx/results`     | Authored fields, ranges, color mapping, and deformation     |

Specialized entry points for camera math, runtime inspection, WebGPU device
ownership, and optional display-only GLB import are documented in the
[API reference](docs/api-reference.md).

## Scope

FemGx renders authored FE geometry, scalar results, nodal-vector deformation,
and bounded elemental orientation glyphs. It does not derive engineering
quantities, own result timelines, or provide a non-WebGPU renderer. See the
[product scope](wiki/requirements/product-scope.md) for the complete supported
and deferred boundaries.

## Documentation

- [API reference and five-minute workflow](docs/api-reference.md)
- [Complete host FE integration](examples/host-integration/README.md)
- [Architecture and API design](wiki/architecture/api-design.md)
- [Contributing and repository development](CONTRIBUTING.md)
