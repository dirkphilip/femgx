# API design north star

The default and only public rendering lifecycle is
`createFemViewport({ canvas, scene })`. The viewport owns the derived
`SceneRuntime`, internal WebGPU renderer, fitted camera, standard controls,
resize synchronization, render invalidation, device recovery, and teardown.
Lower-level renderer construction remains an internal implementation detail;
camera math, stable runtime queries, and pick-id resolution are separate
supported utilities when a host needs them.

This note defines the intended public vocabulary and ownership boundaries for
the experimental API. It is the design reference for changes to the public
surface; the concise [[architecture/core-api|Core API review]] is the reader
oriented API map, and the root [[../index|wiki index]] is the navigation map.

## Canonical concepts

| Concept             | Current representation | Responsibility                                                                       |
| ------------------- | ---------------------- | ------------------------------------------------------------------------------------ |
| Part definition     | `Part` / `createPart`  | Validated immutable reusable geometry, derived bounds, and optional element ranges   |
| Part instance       | `PartPlacement`        | A reference to a part definition plus a local transform                              |
| Assembly definition | `NamedAssembly`        | Ordered hierarchy of part and assembly placements                                    |
| Scene registry      | `Scene`                | Authoritative maps of parts and assemblies plus visibility state                     |
| Scene runtime       | `SceneRuntime`         | Stable placement/assembly-occurrence queries; live mutations belong to `FemViewport` |
| Viewport            | `FemViewport`          | Public scene lifecycle, GPU rendering, interaction attributes, and picking           |

The API may eventually introduce explicit `PartDefinition` and
`PartInstance` names, but it must preserve this semantic distinction even
while the implementation uses the shorter current names.

## Canonical data flow

```text
ElementModel → derived Parts + assembly placements
              ↓
           Scene
              ↓
       createSceneRuntime
              ↓
      FemViewport
```

Reusable geometry is defined once. Instances refer to that definition by a
stable part key and carry only placement-specific state such as transform,
visibility, and interaction style. The renderer must never become the source
of truth for scene data.

`createElementModel(nodes, elements, options)` is the authoring boundary for
typed finite-element data. It owns optional semantic element blocks and bodies,
validates their stable identities and exclusive membership, and keeps omitted
blocks on the zero-block fast path. A body uses direct element membership or
aggregates blocks; it cannot use both. `createPart(id, geometry)` remains the
construction boundary for reusable parts: it validates primitive arrays and
derived element/pick/body/block metadata, derives bounds from positions, and
uses a finite zero box for an empty part. `PartId` is a direct unsigned 32-bit
identity; element, block, and body ids reserve the top raw value because `0` is
the no-hit sentinel. Derived descriptors never become a second authoring
source.

Raw geometry follows this boundary directly:

```ts
const part = createPart(10, { positions, indices, primitive: "triangles" });
```

Typed FE data uses the same reusable-part path. A mixed `ElementModel` is
grouped into one homogeneous `Part` per compatible GPU topology, and an
`Assembly` composes and places those parts without copying their geometry:

```ts
const parts = heterogeneousElementParts({ triangle: 10, line: 11 }, model);
const scene = createScene()
  .addPart(parts.triangle!)
  .addPart(parts.line!)
  .addAssembly({
    id: 1,
    name: "model",
    placements: [
      { kind: "part", partId: 10, transform: identity() },
      { kind: "part", partId: 11, transform: identity() },
    ],
  })
  .withRoot(1)
  .build();
```

## Registry and identity rules

- `Scene.parts` is the part-definition registry, keyed by `PartId`.
- `Scene.assemblies` is the assembly-definition registry, keyed by
  `AssemblyId`.
- A placement references a registry entry; it does not copy geometry.
- An instance identity must remain stable when visibility or draw-order
  compaction changes.
- Runtime slots and GPU-local slots are implementation details and must not
  leak into the authoring API.
- The authoritative CPU representation owns the model data; typed arrays in
  the private packed runtime and GPU buffers are compiled representations. The
  public `SceneRuntime` exposes stable handles and query objects, not slots or
  mutation deltas. Live visibility changes go through `FemViewport`.

## Public API boundary

The main user workflow should be expressible as:

1. Define or import reusable part definitions.
2. Register part and assembly definitions in a scene.
3. Place a definition one or more times with transforms.
4. Create one `FemViewport`.
5. Apply interaction, visibility, results, and lifecycle operations through it.

Low-level flattening, batching, culling, draw-order buffers, GPU record
layouts, and storage capacities are renderer/runtime implementation details.
They remain internal until a concrete host need justifies a separate product
decision and stable public lifecycle contract.

## Design test for new features

A new public concept belongs in the API only when it has a clear owner, a
stable identity/data-ownership story, a place in the canonical data flow, and
an end-to-end example. Otherwise record it as an internal design note or an
issue until the boundary is clear.

Related: [[architecture/architecture-overview|Architecture overview]],
[[architecture/instancing-strategy|Instancing strategy]], and
[[architecture/packed-runtime|Packed scene runtime]].

[../index|wiki index]: ../index.md
[architecture/architecture-overview|Architecture overview]: architecture-overview.md
[architecture/core-api|Core API review]: core-api.md
[architecture/instancing-strategy|Instancing strategy]: instancing-strategy.md
[architecture/packed-runtime|Packed scene runtime]: packed-runtime.md
