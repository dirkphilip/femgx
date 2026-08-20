# Duplication refactor plan — ranked

Follow-up to the AST duplication scan (see [DUPLICATION-ANALYSIS.md](./DUPLICATION-ANALYSIS.md)
for the audit summary). The candidate ordering combines the corrected current
audit with source review. Earlier line estimates are directional only after the
semantic-storage changes in #1199; remeasure each candidate before editing.
False positives are called out explicitly.

The checkers are advisory (exit 0); findings are refactor candidates, not CI
gates. `scripts/duplicates/` and `test/scripts/duplicates/` are the tooling;
`package.json` wires the occasional `npm run audit:duplicates` command (names + bodies + fragments over
`src`, `test`, `demo`).

## Worst offenders

The five biggest, verified duplicate clusters in production `src/`:

| #   | Cluster                                                                                              | Location                                                                                                                                     | Net lines |
| --- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | --------: |
| 1   | Dense element/node selection parallel modules                                                        | `renderer/selection/element-selection.ts` (~255) vs `node-selection.ts` (~269)                                                               |  **−200** |
| 2   | Face topology row construction, sorting, and comparison                                              | `elements/faces.ts`, `geometry/element-mesh-builders.ts`, `geometry/{edge,face}-validation.ts`, and `geometry/{explicit-topology,semantic}/` | remeasure |
| 3   | Bind-group invalidation + `sameTables` + empty-buffer trio                                           | `renderer/frame/deformation.ts` vs `renderer/resources/result-colors.ts` (+ `instance-storage.ts` vs `highlight-storage-allocation.ts`)      |   **−33** |
| 4   | Results helpers re-implemented (`finiteOrZero` ×4, `emptyRecords`, `normalize`/`crossUnit`)          | `results/{load-records,orientation-records,deform}.ts`, `viewport/geometry-bounds.ts`                                                        | remeasure |
| 5   | Small renderer/edges helpers (`sequentialIndices`, `emptyEdgeData`, `nextPowerOfTwo`, `triangleKey`) | `renderer/resources/*`, `renderer/edges/*`, `viewport/bounds/placed-index.ts`                                                                |   **−18** |

The single largest previously verified win remains the dense element/node
selection core. Do not sum the older estimates until each candidate is
remeasured against the current semantic-storage design.

Biggest test-side offenders: the `renderer/resources/draw-resources/*.test.ts`
GPU boilerplate (~−190, 42 repeated `installGpuGlobals` blocks) and the
`test/scripts/*.test.ts` check-script harness (`makeRepo`/`runCheck` ×7,
~−105).

Biggest demo offenders: `benchmark/percentiles` ×8 (−35) and `benchmark/renderFrame` ×6 (−30), both with an existing canonical home in `demo/benchmark/measurement.ts`.

## Ranked refactor opportunities

### Production `src/` (functions + fragments)

| Rank | Opportunity                                                                                                                                               | Net lines | Feasibility | Risk                                                                                                     |
| ---: | --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------: | ----------- | -------------------------------------------------------------------------------------------------------- |
|    1 | Dense-selection generic core (element + node share cache/sort/binary-search/bitmap)                                                                       |      −200 | medium-high | medium (hot path; keep cost-hedge + `ordinal-1` vs `nodeId` semantics identical, rely on existing tests) |
|    2 | Face topology: consolidate only truly shared row merge/sort/compare mechanics while preserving ownership boundaries                                       | remeasure | medium      | medium (matches may encode distinct authoritative representations)                                       |
|    3 | Bind-group invalidation: one `clearCachedPartBindGroups` + generic `sameTables` + one empty-storage-buffer creator in `renderer/resources/bind-groups.ts` |       −33 | high        | low                                                                                                      |
|    4 | Results helpers: review `finiteOrZero`, `emptyRecords`, and vector operations for one existing canonical home                                             | remeasure | high        | low                                                                                                      |
|    5 | Small helpers: `sequentialIndices`, `emptyMeshEdgeData`, `nextPowerOfTwo`, `triangleKey`                                                                  |       −18 | high        | ~zero                                                                                                    |
|    6 | Visibility `contains` (`graph-skin.ts` vs `skins.ts`, byte-identical)                                                                                     |       −11 | high        | ~zero                                                                                                    |
|    7 | Camera/gesture: `modifiersOf` (delete private copy), `assertFinite*`, `clamp`                                                                             |       −16 | high        | low                                                                                                      |
|    8 | Interaction slot-diff walker shared by `interactionAffectedSlots` + `changedInstanceSlots`                                                                |       −14 | medium      | low                                                                                                      |
|    9 | Gizmo `formatPoint`/`finite`                                                                                                                              |        −6 | high        | low                                                                                                      |
|   10 | Interaction setters — mostly already factored onto `mechanics.ts` helpers; remaining glue is public API surface. Skip as a refactor                       |        −0 | —           | —                                                                                                        |

Explicitly **not** worth it: `resetPickTargets`/`destroyTransparencyTargets`
(idiomatic teardown, disjoint field lists), `boundsScale` (different math),
`interpolate` (different operand types), `mapping.normalize` (unrelated concern).

### Factoring out shared types (the requested focus)

Verified same-concept duplicates that can collapse onto one canonical type.
All public-facing renames are export-preserving aliases (zero API churn):

| Rank | Duplicate pair(s)                                                                                | Canonical home                              |               Net lines |
| ---: | ------------------------------------------------------------------------------------------------ | ------------------------------------------- | ----------------------: |
|    1 | Dense element/node layout + occurrence + selections types (feeds refactor #1)                    | new `renderer/selection/dense-selection.ts` | (counted in −200 above) |
|    2 | `OrientationGlyphRecordSource` ≡ `ElementalOrientationRecords` (file already imports the target) | `results/orientation-records.ts`            |                     −12 |
|    3 | `GeometryBody` ≡ `Body`                                                                          | `elements/model-types.ts`                   |                      −7 |
|    4 | `BoxSelectionModifiers` ≡ `ViewportInteractionModifiers`                                         | `interaction/box-selection.ts`              |                      −9 |
|    5 | `GpuWriteCost`/`MutableWriteCost` + Draw/Memory pairs (readonly/mutable)                         | `renderer/diagnostics/cost.ts`              |                      −9 |
|    6 | `Bounds`/`MutableBounds` derived via mapped type                                                 | `geometry/types.ts`                         |                      −6 |
|    7 | `ModelSet` ≡ `PendingSet`                                                                        | `io/fem-model.ts`                           |                      −4 |
|    8 | `HiddenInteractionIds`/`Tuple` (same names + bodies)                                             | `renderer/attachment/interaction.ts`        |                      −2 |
|    9 | Numeric identity aliases and point triples → review canonical imports without merging domains    | `elements/element.ts`, `math/vec3.ts`       |    ~0 (consistency win) |

Do **not** consolidate same-shape-different-concept types (structural-noise
matches from the checker): the two 8-file "identical" clusters
(`RenderPixel`/`CanvasCssPoint`/`GesturePoint`/…, `Color`/`ResolvedPickIds`/…),
`ScreenPoint` (has NDC depth), `FrustumPlane` vs `FiniteVector`,
`ElementPrimitiveRange` vs `SelectionDrawRange`, `TessellationOptions` vs
`FaceSubset`, `ElementShape` vs `InteractionGranularity`,
`RawIdentity` vs `ResolvedPickIds` (renderer internals vs public result),
`Hex20CylinderOptions` vs `ElementExtent`. The checker's
`typeShapeFingerprint` matches on member-count + member-type only, so these
are name-normalization noise, not duplication.

### `test/`

| Rank | Opportunity                                                                                        | Net lines |                                                         Home |
| ---: | -------------------------------------------------------------------------------------------------- | --------- | -----------------------------------------------------------: |
|    1 | draw-resources GPU boilerplate → `withGpuGlobals`/`beginPass` (42 blocks)                          | −170…−210 | `test/renderer/resources/draw-resources/support.ts` (exists) |
|    2 | `makeRepo`/`runCheck`/`tempDirs`/`afterEach` harness ×7                                            | −90…−120  |                          new `test/scripts/check-support.ts` |
|    3 | `installNavigator` ×6, `installGpuTestGlobals` ×2-3, restore blocks, `deferred`, `bufferDestroyed` | −50…−65   |                           `test/renderer/fake-gpu/` (exists) |
|    4 | `runtimeInstances` ×3 (13-line clone)                                                              | −28…−30   |                `test/scene-runtime/scene-runtime/support.ts` |
|    5 | `FakeCanvas`/`PointerInput`/`pointer()` (interaction copies)                                       | −25…−35   |           `test/interaction/viewport-interaction-support.ts` |
|    6 | `transformedBounds` ×2 (same dir, 26 lines each)                                                   | −26       |                          new `test/demo/fixtures/support.ts` |
|    7 | `part` ×4 identical copies (2 support modules + 2 test files)                                      | −12…−16   |                               existing scene-runtime support |
|    8 | `KeyboardTarget`, `deferred`, `percentile`, `requireCase`, `rect`/`ids`/`ScheduledFrame`           | −20…−30   |                                     existing support modules |

False positives (keep): `CaseId` (values genuinely differ), `SelectionFixture`,
`VisibilityFixture`, `details`, `buildScene`, `triangleGeometry`, `fakeViewport`,
`pointAt`, and the 47-line "golden-output clone" in `scripts/duplicates`
(parallel structure, distinct assertions).

### `demo/`

| Rank | Opportunity                                                | Net lines |                                        Home |
| ---: | ---------------------------------------------------------- | --------- | ------------------------------------------: |
|    1 | `percentiles` ×8                                           | −35       | export from `demo/benchmark/measurement.ts` |
|    2 | `renderFrame` ×6                                           | −30       |             `demo/benchmark/measurement.ts` |
|    3 | `tetNodes` ×2 (byte-identical)                             | −14…−16   |                 shared tet4-topology helper |
|    4 | `midNode`/`corner` (benchmark vs fixtures)                 | ~−11      |                       shared builder helper |
|    5 | `playbackField`/`legendField` + duplicate field interfaces | −9        |             shared workbench results module |
|    6 | `frameIntervals` ×2                                        | −8        |          demo shared module (boundary-safe) |
|    7 | `assertOpaqueSubmission` tail                              | −6…−8     |                   shared `assertOpaqueDraw` |
|    8 | `selectionNoun` ×2, `subtract` → `math/vec3`               | −7        |                workbench interaction module |

False positives (keep): `measureScenario`, `submittedTriangleCount` (different
fidelity/APIs), the `parse*` trio (pattern clone; a generic would lose type
narrowing).

## Execution order

Start with the low-risk clusters (bind-group trio, small helpers,
percentiles/renderFrame in demo), then the dense-selection core (the biggest
previously verified win; preserve the cost hedge and bit semantics), then audit
the face-topology matches individually. Re-run `npm run audit:duplicates` after
each change and remeasure the actual net reduction rather than relying on the
pre-#1199 totals.

## Recommendations for better tooling

The AST checkers are audit-only tools; these are the gaps and next
steps, in priority order.

1. **Add a `--format json` / machine-readable mode.** The human-readable output
   is fine for review but not for comparing occasional audits. A JSON mode
   (per-cluster: files, line ranges, score) would support local result diffing.
   Suggested flag: `--json`, emitted to stdout with the same ignore handling.

2. **Keep the commands audit-only.** `check-names` is fast and catches parallel
   abstractions early, but all three reports include intentional repeats. Run
   `npm run audit:duplicates` deliberately; do not add it to default linting or
   CI.

3. **Report `ElementId`-style type drift explicitly.** Because
   `typeShapeFingerprint` ignores property names, the checker flags
   same-shape-different-concept noise (the two 8-file clusters). A names-aware
   type report — "same name, same shape" vs "same shape, different name" —
   would separate genuine consolidation targets (shared `Bounds`, `Vec3`) from
   coincidental shapes. This is the highest-value enhancement for the
   factor-out-types effort.

4. **Add a scan-root flag for single-file or subsystem drill-down.** A `--path`
   filter (e.g. `--path renderer/selection`) would make focused refactor audits
   easier even though the complete scan is now fast.

5. **Hook the fragment `--min-lines 10` scan into the refactor PRs.** After
   each of the ranked clusters lands, re-run and expect the specific clone to
   disappear. A tiny script (`scripts/duplicates/expect-clear.mjs <report>`
   reading a JSON ignore of "should-be-gone" clusters) would encode that check
   cheaply without a hard CI gate.

6. **Consider text-level detection for literal paste.** The AST tools catch
   renamed copy-paste but not literal pastes with identical identifiers; the
   README already notes jscpd as a complement. If the ranked clusters get
   refactored, a one-off jscpd pass over `src/` would find any remaining
   literal clones the structural tools miss.

Keep these as deliberate audit commands rather than default lint or CI gates;
the complete reports intentionally include repeated names and structural noise.
