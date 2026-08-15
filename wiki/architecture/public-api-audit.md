# Public API audit

The public surface is owned by the explicit facades under `src/entries/` and
checked by `test/public-api/entry-inventory.test.ts` plus package smoke. This
note records ownership and scope without duplicating a symbol inventory that
would drift from the source facades.

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
| `scene-runtime/`, `platform/` | Deliberately advanced runtime queries and WebGPU capability/device contracts, published as `femgx/runtime` and `femgx/platform`. Packed storage and renderer lifecycle remain internal.             |

The root `femgx` entry is intentionally limited to the canonical application
workflow. `femgx/model`, `femgx/io`, `femgx/io/glb`, `femgx/camera`,
`femgx/runtime`, and `femgx/platform` are the only supported subpaths. There
are no wildcard or source-tree exports. Primitive-specific geometry leaves are
represented by the public `Geometry` union; GPU resource layouts remain internal.

The package smoke suite must consume the canonical viewport, scene, and results
contracts rather than renderer records or derived runtime storage. The public
runtime exposes `RuntimeInstance` as its sole materialized placed-part record;
the renderer-shaped `Instance` record and packed slots remain internal. No
compatibility aliases are maintained for this experimental 0.x product. See
the [[architecture/api-design|API design north star]] for the canonical
workflow and [[data/results|Results]] for the authored-results boundary.

[docs/api-reference]: ../../docs/api-reference.md
[architecture/api-design|API design north star]: api-design.md
[data/results|Results]: ../data/results.md
