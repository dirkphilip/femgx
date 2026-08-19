# Duplication analysis (AST checkers)

Run of `scripts/duplicates/{check-names,check-bodies,check-fragments}.mjs` over
`src/`, `test/`, and `demo/` with default thresholds plus
`--min-lines 10` for fragments. Structural (identifier-normalized) matching:
names, whole-declaration bodies, and statement windows inside functions.

Raw findings feed the ranked refactor plan below; per-cluster investigation and
estimates are the result of parallel worker analysis (see "Investigation" for
each cluster).

## Data sources

- `src` names: 44 repeated top-level declaration names across 2+ files.
- `src` bodies: 40 identical-body clusters (functions + interfaces + types).
- `src` fragments (`--min-lines 10`): 22 clone reports down to 10-line windows.
- `test` names: 41 clusters; `test` bodies: 22 clusters; `test` fragments: 40.
- `demo` names: 12 clusters; `demo` bodies: 11 clusters; `demo` fragments: 1.

## src type consolidation clusters (bodies checker, "Same type/interface body")

Highest-value, most repeated shapes (identical after identifier normalization):

| Shape                                                    | Files                                                                                                                                                                                        |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ElementId` (`type` = number)                            | `elements/element.ts:7`, `geometry/packed/packed-semantic-index.ts:16`, `geometry/part-semantic-index.ts:17`, `geometry/part-semantic-types.ts:4`                                            |
| `Bounds`-like (`{min,max}`)                              | `geometry/types.ts:33 Bounds`, `interaction/box-selection.ts:7 BoxSelectionRect`, `viewport/geometry-bounds.ts:26 MutableBounds`                                                             |
| point/vector 3-cluster                                   | `camera/project-polygon.ts:12 ScreenPoint`, `math/vec3.ts:5 Vec3`, `viewport/orientation-gizmo-svg.ts:20 CubePoint` (+ `results/load-records.ts:7 Vec3`)                                     |
| 8-file identical shape                                   | `RenderPixel`, `CanvasCssPoint`, `GesturePoint`, `Edge`, `SourcePosition`, `GpuWriteCost`, `MutableWriteCost`, `ValueRange`, `ProjectedPoint`, `ViewportStats`                               |
| 8-file identical shape                                   | `CameraContentInset`, `ScreenBounds`, `RectBounds`, `OrthographicExtents`, `Color`, `FlattenOffsets`, `ResolvedPickIds`, `OrbitPivotMetrics`, `RenderPixelRect`, `RawIdentity`, `Quaternion` |
| 4-file identical shape                                   | `ClipPoint`, `EdgeCondition`, `Rgba`, `TriangleOwnerPair`                                                                                                                                    |
| Parallel dense-selection types                           | `element-selection.ts` `DenseElementLayout`/`DenseElementOccurrence` vs `node-selection.ts` `DenseNodeLayout`/`DenseNodeOccurrence`                                                          |
| `HiddenInteractionIds`/`HiddenInteractionTuple`          | `renderer/attachment.ts:43-44` vs `renderer/attachment/interaction.ts:23-24` (same names AND bodies)                                                                                         |
| `ElementModelOptions` ≡ `ElementModelConversionOptions`  | `elements/model-types.ts:23` vs `io/conversions/element-model.ts:13`                                                                                                                         |
| `Body` ≡ `GeometryBody`                                  | `elements/model-types.ts:10` vs `geometry/types.ts:20`                                                                                                                                       |
| `BoxSelectionModifiers` ≡ `ViewportInteractionModifiers` | `interaction/box-selection.ts:26` vs `interaction/viewport-interaction-types.ts:30`                                                                                                          |
| `ModelSet` ≡ `PendingSet`                                | `io/fem-model.ts:52` vs `io/model-builder.ts:19`                                                                                                                                             |
| `ElementPrimitiveRange` ≡ `SelectionDrawRange`           | `geometry/types.ts:69` vs `renderer/resources/draw-resources.ts:72`                                                                                                                          |

## src identical function bodies

| Cluster                                                         | Files                                                                                                                                      |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `clamp` ×2                                                      | `interaction/box-frustum.ts:168`, `interaction/box-selection.ts:290`                                                                       |
| `modifiersOf` ×2                                                | `interaction/box-selection.ts:281`, `interaction/viewport-interaction-helpers.ts:18`                                                       |
| `assertFinite`/`assertFiniteNumber` ×2                          | `camera/camera.ts:354`, `camera/navigation.ts:175`                                                                                         |
| `validateNodePositions` ×2                                      | `geometry/packed/packed-validation.ts:95`, `geometry/part.ts:188`                                                                          |
| `sameTables` + `invalidateBindGroups` + `createEmpty*Buffer` ×2 | `renderer/frame/deformation.ts:146,252,262`, `renderer/resources/result-colors.ts:36,175,184`                                              |
| `contains` ×2 (byte-identical)                                  | `renderer/visibility/packed-skin.ts:65`, `renderer/visibility/skins.ts:352`                                                                |
| `emptyRecords` ×2                                               | `results/load-records.ts:65`, `results/orientation-records.ts:343`                                                                         |
| `formatPoint`/`finite` ×2                                       | `viewport/orientation-gizmo-axis.ts:127,141`, `viewport/orientation-gizmo-svg.ts:396,419`                                                  |
| `sequentialIndices` ×2                                          | `renderer/resources/surface-geometry.ts:125`, `renderer/resources/triangle-upload.ts:64`                                                   |
| `emptyEdgeData`/`emptyMeshEdgeData` ×2                          | `renderer/edges/dense-unowned-edge.ts:246`, `renderer/resources/geometry-buffers.ts:114`                                                   |
| `nextPowerOfTwo` ×2                                             | `renderer/selection/highlight-table.ts:95`, `viewport/bounds/placed-index.ts:152`                                                          |
| `finiteOrZero`/`finite` ×4                                      | `results/deform.ts:114`, `results/load-records.ts:197`, `results/orientation-records.ts:433`, `viewport/geometry-bounds.ts:403`            |
| dense-selection mirrors                                         | `element-selection.ts` vs `node-selection.ts`: `instanceUsesDenseSelection`, `dense*OccurrenceAtSlot`, `sortedInstances`                   |
| interaction setters (5 files, 10+ fns)                          | `interaction/{bodies,edges,faces,interaction,nodes}.ts` `set*Selected`/`set*Highlighted`/`set*Override` (thin delegates to shared helpers) |

## src fragment clones (10+ lines)

| Size    | Clone                                                                                                                                            |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 16-line | `geometry/packed/packed-validation.ts:77-92 validateGeometry` vs `geometry/part.ts:245-261 validateGeometryArrays`                               |
| 14-line | `renderer/selection/element-selection.ts:65-78 collectDenseElementSelections` vs `node-selection.ts:63-76 collectDenseNodeSelections`            |
| 13-line | dense occurrence binary search (`dense*OccurrenceAtSlot`)                                                                                        |
| 13-line | `elements/model-validation.ts:74-86 validateBodies` vs `geometry/part-validation.ts:234-246 collectBodyElements`                                 |
| 12-line | `renderer/interaction-sync.ts:85-96 interactionAffectedSlots` vs `viewport/interaction-diff.ts:47-70 changedInstanceSlots`                       |
| 11-line | `invalidateBindGroups` (deformation vs result-colors)                                                                                            |
| 11-line | `renderer/picking/pick.ts:389-399 resetPickTargets` vs `renderer/resources/color-targets.ts:246-256 destroyTransparencyTargets`                  |
| 10-line | `setBodyOverride` vs `setElementOverride`                                                                                                        |
| 10-line | `renderer/resources/instance-storage.ts:446-455 invalidateBindGroups` vs `highlight-storage-allocation.ts:112-121 invalidateHighlightBindGroups` |
| 10-line | `elements/model-validation.ts:59-68 validateBodies` vs `geometry/part-validation.ts:201-210 validateBodyOrder`                                   |

## test duplication

- Scripts-test harness: `makeRepo`/`runCheck` duplicated across 7 files
  (`scripts/check-*.test.ts`, `scripts/duplicates/*.test.ts`).
- `installNavigator` ×6, `installTestGpuGlobals` ×2-3, `part` ×5,
  `runtimeInstances` ×3, `CaseId` ×3, `ScheduledFrame` ×3, `denseSelection` ×2,
  `deferred` ×2, `triangleGeometry` ×5, `ids` ×3, `rect` ×2.
- `renderer/resources/draw-resources/*.test.ts` (batches/overlays/targets/
  geometry/selection): 10-14-line boilerplate clusters across 4+ files.
- 47-line module-level clone: `check-bodies.test.ts:70-116` vs
  `check-names.test.ts:44-87` (the two checker test suites share an entire
  golden-output assertion block).
- `scene-runtime/*.test.ts` module-level scene-boilerplate clones (17-line).

## demo duplication

- `benchmark/`: `percentiles` ×8, `renderFrame` ×6, `tetNodes` ×2
  (byte-identical, 14-line fragment), `frameIntervals` ×2, `measureScenario` ×2,
  `assertOpaqueSubmission` ×2, `submittedTriangleCount` ×2.
- `workbench/interaction/`: `selectionNoun` ×2 (box-selection-controller vs
  viewport-binding).
- `workbench/results/`: `playbackField`/`legendField`; parallel
  `WorkbenchResultLegendField`/`WorkbenchResultPlaybackField` interface bodies.
- Fixtures: `HexCorners`/`HexCell` type pair, `corner`/`midNode` helpers,
  `BoltedPlateOptions`/`FastenerHeights`/`DenseEdgeTypedMemoryEstimate` shape.

## Notes / false-positive risk

- Several "same body" hits are trivial single-expression functions (identity,
  `x => x`, empty init) where the normalized bodies legitimately coincide;
  e.g. `createModelBuilder`/`regionTargetsChangedError`,
  `packedElementTransient`/`setTargetHovered`. These are noise, not targets.
- Interaction `set*` family is already factored onto shared helpers
  (`updateNestedState`, `updateNestedMap`); the repeated bodies are public API
  surface, so consolidation must preserve exported symbols.
- `attachment.ts` vs `attachment/interaction.ts` are different files; only the
  `HiddenInteractionIds`/`HiddenInteractionTuple` pair is duplicated.
