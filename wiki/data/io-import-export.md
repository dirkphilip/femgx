# IO: VTK legacy import/export

The `src/io/` subsystem provides the versioned typed interchange model and the
single supported format adapter: VTK legacy ASCII. See also
[[architecture/source-organization|Source organization]].

## Interchange model (`io/model.ts`)

`FemModel` is the versioned, fully serializable interchange format:

- `nodes` — `ids: Uint32Array` + `coordinates: Float64Array` (3 per node).
- `elementBlocks` — rows grouped by `ElementShape`; ids unique across blocks.
- `sets` — named node/element id groups.
- `metadata` — string-keyed record, insertion order preserved.
- `results` — named fields aligned to node/element ids with `components`.

Because every array is a typed array and every value is a plain object, a
`FemModel` passes directly across Web Worker `postMessage` boundaries. Bump
`FEMGX_FORMAT_VERSION` when a writer changes field semantics.

## Model builder (`io/build.ts`)

`createModelBuilder()` accumulates typed-array chunks (`appendNodes`,
`openElementBlock`, `appendElements`, `addSet`, `setMetadata`, `addResult`)
used by the VTK reader and by tests when constructing models.

## Adapter

| Format     | Reader     | Writer     | Notes                          |
| ---------- | ---------- | ---------- | ------------------------------ |
| VTK legacy | `parseVtk` | `writeVtk` | ASCII `UNSTRUCTURED_GRID` only |

The package root deliberately exposes only these explicit VTK entry points;
parser sessions and generic aliases remain internal. Unknown keywords are
skipped; unsupported cell types produce warnings and are omitted;
malformed records produce actionable `Issue`s with stable `code`s (see
`io/diagnostics.ts`).

## Format capabilities

- **IDs**: VTK has implicit ids. `writeVtk` preserves coordinate row order and
  remaps authoritative node and element ids to those emitted rows; a parsed
  file therefore receives dense 0..n-1 ids, while geometry and result
  associations remain intact.
- **Sets / metadata**: VTK legacy has no set or metadata concept.
- **Results**: complete node and element fields are reordered by identity to
  POINT_DATA and CELL_DATA row order. Partial, duplicate, unknown, or
  non-finite fields fail with `VtkWriteError`; unsupported component counts are
  rejected instead of being silently omitted.

The dense ids after parsing are an unavoidable VTK limitation, not a loss of
the original associations. Callers should match entities by coordinate and
connectivity position when comparing a written model with its parsed result.

## Module split

- `vtk.ts` — top-level keyword dispatch and header handling.
- `vtk-cells.ts` — POINTS / CELLS / CELL_TYPES assembly.
- `vtk-data.ts` — POINT_DATA / CELL_DATA arrays.
- `vtk-write.ts` — deterministic ASCII export.
- `session.ts` — shared parse session + `finishParse` validation.
- `validate.ts` / `diagnostics.ts` / `numbers.ts` / `growable.ts` — shared
  helpers.

## Out of scope

VTU, Gmsh, Abaqus adapters, cooperative cancellation, and progress reporting
were removed to match [[requirements/product-scope|product scope]]. Do not
re-add them without an explicit scope decision.

[architecture/source-organization|Source organization]: ../architecture/source-organization.md
[requirements/product-scope|product scope]: ../requirements/product-scope.md
