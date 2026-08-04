# API design north star

This note defines the intended public vocabulary and ownership boundaries for
the experimental API. It is the design reference for changes to the public
surface; the root [[index|wiki index]] is the navigation map.

## Canonical concepts

| Concept             | Current representation | Responsibility                                                      |
| ------------------- | ---------------------- | ------------------------------------------------------------------- |
| Part definition     | `Part`                 | Immutable reusable geometry, bounds, and optional element ranges    |
| Part instance       | `PartPlacement`        | A reference to a part definition plus a local transform             |
| Assembly definition | `NamedAssembly`        | Ordered hierarchy of part and assembly placements                   |
| Scene registry      | `Scene`                | Authoritative maps of parts and assemblies plus visibility state    |
| Scene runtime       | `SceneRuntime`         | Packed stable instance slots, transforms, visibility, and deltas    |
| Renderer            | `WebGpuRenderer`       | GPU resources, draw submission, interaction attributes, and picking |

The API may eventually introduce explicit `PartDefinition` and
`PartInstance` names, but it must preserve this semantic distinction even
while the implementation uses the shorter current names.

## Canonical data flow

```text
part definitions + assembly placements
              ↓
           Scene
              ↓
       createSceneRuntime
              ↓
          WebGpuRenderer
```

Reusable geometry is defined once. Instances refer to that definition by a
stable part key and carry only placement-specific state such as transform,
visibility, and interaction style. The renderer must never become the source
of truth for scene data.

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
  the runtime and GPU buffers are compiled representations.

## Public API boundary

The main user workflow should be expressible as:

1. Define or import reusable part definitions.
2. Register part and assembly definitions in a scene.
3. Place a definition one or more times with transforms.
4. Compile one scene runtime.
5. Render the runtime and apply interaction deltas.

Low-level flattening, batching, culling, draw-order buffers, GPU record
layouts, and storage capacities are renderer/runtime implementation details.
They may be exposed later through deliberate advanced entry points, but new
features should not add them to the default root API merely because they are
convenient internally.

## Design test for new features

A new public concept belongs in the API only when it has a clear owner, a
stable identity/data-ownership story, a place in the canonical data flow, and
an end-to-end example. Otherwise record it as an internal design note or an
issue until the boundary is clear.

Related: [[architecture/architecture-overview|Architecture overview]],
[[architecture/instancing-strategy|Instancing strategy]], and
[[architecture/packed-runtime|Packed scene runtime]].
