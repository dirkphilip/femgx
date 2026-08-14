# Public API audit

The exhaustive public surface is owned by `src/index.ts` and checked by the
generated [API reference][docs/api-reference]. This note records ownership and
scope without duplicating a symbol inventory that would drift from the source
barrel.

## Ownership map

| Owner                         | Public contract                                                                                                                                                                                     |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scene/`, `geometry/`         | Reusable parts, geometry, hierarchical assemblies, and the authoritative scene registry.                                                                                                            |
| `elements/`                   | Typed finite-element topology, model construction, and immutable semantic editing.                                                                                                                  |
| `viewport/`                   | The canonical WebGPU lifecycle facade, including authored results and interaction integration.                                                                                                      |
| `interaction/`, `picking/`    | Host-owned target state, box-selection queries, and typed GPU hit conversion.                                                                                                                       |
| `results/`                    | Authored scalar/vector fields, ranges, color maps, nodal deformation, and the bounded elemental orientation role. Derived engineering quantities and generalized glyph systems remain out of scope. |
| `io/`                         | Validated model diagnostics, VTK interchange, and the narrow supported GLB display-scene importer.                                                                                                  |
| `camera/`, `math/`            | Supported camera navigation and authoring math used directly by applications.                                                                                                                       |
| `scene-runtime/`, `platform/` | Deliberately advanced runtime queries and WebGPU capability/device contracts. Packed storage and renderer lifecycle remain internal.                                                                |

Categories in TypeDoc organize the complete root surface for readers; they do
not create subpath imports or add stability guarantees. The root barrel remains
the only public entry point. `LinearGeometry` is an internal union helper used
by the geometry descriptor and is intentionally excluded from TypeDoc because
it is not exported from that entry point.

The package smoke suite must consume the canonical viewport, scene, and results
contracts rather than renderer records or derived runtime storage. No
compatibility aliases are maintained for this experimental 0.x product. See
the [[architecture/api-design|API design north star]] for the canonical
workflow and [[data/results|Results]] for the authored-results boundary.

[docs/api-reference]: ../../docs/api-reference.md
[architecture/api-design|API design north star]: api-design.md
[data/results|Results]: ../data/results.md
