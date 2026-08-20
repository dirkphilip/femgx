# Duplication analysis (AST checkers)

Run of `scripts/duplicates/{check-names,check-bodies,check-fragments}.mjs` over
`src/`, `test/`, and `demo/` with default thresholds plus
`--min-lines 10` for fragments. Structural (identifier-normalized) matching:
names, whole-declaration bodies, and statement windows inside functions.

Raw findings feed the ranked refactor plan below; per-cluster investigation and
estimates are the result of parallel worker analysis (see "Investigation" for
each cluster).

## Data sources

- `src` names: 54 repeated top-level declaration names across 2+ files.
- `src` bodies: 68 identical-body clusters (functions + interfaces + types).
- `src` fragments (`--min-lines 10`): 14 maximal clone reports.
- `test` names: 44 clusters; `test` bodies: 19 clusters; `test` fragments: 10.
- `demo` names: 10 clusters; `demo` bodies: 14 clusters; `demo` fragments: 1.

## Current high-signal body clusters

- Dense selection mirrors `Dense*Layout`, `Dense*Occurrence`, candidates,
  `instanceUsesDenseSelection`, occurrence lookup, and sorting between element
  and node selection.
- Face/edge topology repeats sorting, pair-index lookup, edge-index lookup, and
  canonical face comparison across `elements/faces.ts`,
  `geometry/element-mesh-builders.ts`, `geometry/{edge,face}-validation.ts`, and
  `geometry/semantic/`.
- Deformation and result-color resources repeat `sameTables`, bind-group
  invalidation, and empty-buffer creation.
- `finiteOrZero`/`finite` occurs in four result/bounds modules; `emptyRecords`
  occurs in load and orientation records.
- `sequentialIndices`, `nextPowerOfTwo`, `emptyEdgeData`, `formatPoint`,
  `clamp`, and `modifiersOf` each have two implementations.
- `Body`/`GeometryBody`, box-selection modifiers, model/pending sets,
  orientation record sources, bounds shapes, and attachment hidden-id types are
  same-shape pairs worth semantic review.
- Large same-shape interface clusters remain structural noise: coordinate
  pairs, colors, ranges, costs, pick ids, and quaternions are not one domain
  concept merely because their member types match.

## src fragment clones (10+ lines)

| Size    | Clone                                                                                                                                            |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 24-line | repeated windows in `renderer/interaction-sync.ts:85-100 interactionAffectedSlots` vs `viewport/interaction-diff.ts:47-70 changedInstanceSlots`  |
| 16-line | face-row merging/sorting across `elements/faces.ts` and `geometry/{explicit-topology,semantic}/`                                                 |
| 16-line | face-row merging/sorting across `geometry/element-mesh-builders.ts` and `geometry/semantic/surface-edge-fragments.ts`                            |
| 14-line | `renderer/selection/element-selection.ts:65-78 collectDenseElementSelections` vs `node-selection.ts:63-76 collectDenseNodeSelections`            |
| 14-line | semantic face-ordinal lookup in `face-subset-columns.ts` vs `part-semantic-graph.ts`                                                             |
| 13-line | dense occurrence binary search (`dense*OccurrenceAtSlot`)                                                                                        |
| 13-line | canonical face writing in `elements/faces.ts` vs `geometry/element-mesh-builders.ts`                                                             |
| 12-line | canonical face/node comparison across geometry builders                                                                                          |
| 12-line | face-row merging/sorting across `elements/faces.ts` and `geometry/explicit-topology/identity.ts`                                                 |
| 11-line | `invalidateBindGroups` (deformation vs result-colors)                                                                                            |
| 11-line | `renderer/picking/pick.ts:389-399 resetPickTargets` vs `renderer/resources/color-targets.ts:246-256 destroyTransparencyTargets`                  |
| 11-line | `renderer/visibility/graph-skin.ts:64-74 contains` vs `renderer/visibility/skins.ts:355-365 contains`                                            |
| 10-line | `setBodyOverride` vs `setElementOverride`                                                                                                        |
| 10-line | `renderer/resources/instance-storage.ts:446-455 invalidateBindGroups` vs `highlight-storage-allocation.ts:112-121 invalidateHighlightBindGroups` |

## test duplication

- Scripts-test harness: `makeRepo`/`runCheck` duplicated across 7 files
  (`scripts/check-*.test.ts`, `scripts/duplicates/*.test.ts`).
- `installNavigator` ×6, `installTestGpuGlobals` ×2-3, `part` ×5,
  `runtimeInstances` ×3, `CaseId` ×3, `ScheduledFrame` ×3, `denseSelection` ×2,
  `deferred` ×2, `triangleGeometry` ×5, `ids` ×3, `rect` ×2.
- `renderer/resources/draw-resources/*.test.ts` (batches/overlays/targets/
  geometry/selection): 10-14-line boilerplate clusters across 4+ files.
- Module-level clone between `check-bodies.test.ts` and `check-names.test.ts`
  (the two checker test suites share a large golden-output assertion block).
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
