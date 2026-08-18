# 0.x viewport capability migration

The experimental 0.x viewport now groups host responsibilities behind stable
capability facades. The `Viewport` object remains the only lifecycle owner; no
facade is constructed, destroyed, or recovered independently.

| Previous flat member                                 | Composed replacement                                     |
| ---------------------------------------------------- | -------------------------------------------------------- |
| `viewport.camera`                                    | `viewport.view.camera`                                   |
| `viewport.setCamera(camera, options)`                | `viewport.view.setCamera(camera, options)`               |
| `viewport.fitView(options)`                          | `viewport.view.fit(options)`                             |
| `viewport.fitSelection(options)`                     | `viewport.view.fitSelection(options)`                    |
| `viewport.interaction`                               | `viewport.interaction.state`                             |
| `viewport.setInteraction(state)`                     | `viewport.interaction.set(state)`                        |
| `viewport.pick(x, y, granularity)`                   | `viewport.interaction.pick(x, y, granularity)`           |
| `viewport.pickRegion(rect, granularity)`             | `viewport.interaction.pickRegion(rect, granularity)`     |
| `viewport.setPartVisible(id, visible)`               | `viewport.visibility.setPart(id, visible)`               |
| `viewport.setAssemblyVisible(id, visible)`           | `viewport.visibility.setAssembly(id, visible)`           |
| `viewport.setAssemblyOccurrenceVisible(id, visible)` | `viewport.visibility.setAssemblyOccurrence(id, visible)` |
| `viewport.setInstanceVisible(id, visible)`           | `viewport.visibility.setPartOccurrence(id, visible)`     |
| `viewport.results`                                   | `viewport.results.state`                                 |
| `viewport.setResults(config)`                        | `viewport.results.set(config)`                           |
| `viewport.clearResults()`                            | `viewport.results.clear()`                               |
| `viewport.sectionPlane`                              | `viewport.presentation.sectionPlane`                     |
| `viewport.setSectionPlane(plane)`                    | `viewport.presentation.setSectionPlane(plane)`           |
| `viewport.clearSectionPlane()`                       | `viewport.presentation.clearSectionPlane()`              |
| `viewport.setBackground(background)`                 | `viewport.presentation.setBackground(background)`        |
| `viewport.setPointSizePixels(size)`                  | `viewport.presentation.setPointSizePixels(size)`         |
| `viewport.setNodeSizePixels(size)`                   | `viewport.presentation.setNodeSizePixels(size)`          |
| `viewport.setEdgeDepthTest(enabled)`                 | `viewport.presentation.setEdgeDepthTest(enabled)`        |

The root keeps `scene`, `runtime`, `replaceScene`, `reconcileScene`, `batch`,
`resize`, `invalidate`, `render`, `recover`, `destroy`, and `stats`. Capability
references remain stable while the live state behind them changes. State reads
and capability operations throw after `viewport.destroy()`.

Visibility mutations validate the active scene/runtime boundary. An unknown
part, assembly, assembly occurrence, or part occurrence throws the exported
`UnknownSceneIdentityError`, whose `kind` and `id` fields are safe to inspect.
Valid idempotent visibility changes remain no-ops.
