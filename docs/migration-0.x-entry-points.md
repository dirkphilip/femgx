# 0.x entry-point migration

The experimental 0.x package now publishes explicit entry points. There are no
compatibility re-exports; update imports directly.

| Former root import                                                                                              | Current import                                  | Reason                                                                              |
| --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------- |
| `createElement`, `createElementModel`, `editElementModel`, `elementPart`, shapes, faces, edges, polygon helpers | `femgx/model`                                   | FE authoring and topology have one domain owner.                                    |
| `FemModel`, diagnostics, model builders, and model-result conversion                                            | `femgx/io`                                      | Host-supplied serializable FE models and conversions are optional domain concerns.  |
| `importGlb`, `GlbImportOptions`, `GlbSceneImport`                                                               | `femgx/io/glb`                                  | GLB/Draco code stays out of the core bundle.                                        |
| Camera construction, projection, coordinates, fitting, and controls                                             | `femgx/camera`                                  | Custom camera shells are advanced viewport utilities.                               |
| `createSceneRuntime`, `SceneRuntime`, `RuntimeInstance`, `RuntimeOccurrence`                                    | `femgx/runtime`                                 | CPU runtime inspection is separate from the ordinary viewport workflow.             |
| Adapter/device request primitives and device-loss types                                                         | `femgx/platform`                                | Raw supported-path WebGPU ownership is explicit.                                    |
| Renderer style resolvers, `Instance`, packed/runtime helpers, and renderer pick errors                          | Removed                                         | These are renderer-shaped implementation details without a supported host workflow. |
| `FemViewport`, `FemViewportOptions`, `createFemViewport`                                                        | `Viewport`, `ViewportOptions`, `createViewport` | The 0.x lifecycle rename removes the redundant FEM prefix.                          |

The canonical root remains `femgx`: create reusable parts, register assembly
placements in a scene, create `Viewport`, then apply interaction and authored
results through that viewport. `viewport.runtime` is the current live query
facade; `createSceneRuntime(scene)` is an optional standalone CPU snapshot.
