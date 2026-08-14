# IO: VTK legacy import/export

The `src/io/` subsystem provides the versioned typed interchange model and the
single supported format adapter: VTK legacy ASCII. See also
[[architecture/source-organization|Source organization]].

## Interchange model (`io/model.ts`)

`FemModel` is the versioned, fully serializable interchange format:

- `nodes` — `ids: Uint32Array` + `coordinates: Float64Array` (3 per node).
- `elementShapeBlocks` — rows grouped by `ElementShape`; ids unique across blocks.
- `sets` — named node/element id groups.
- `metadata` — string-keyed record, insertion order preserved.
- `results` — named fields aligned to node/element ids with `components`.

Because every array is a typed array and every value is a plain object, a
`FemModel` is fully serializable. Bump `FEMGX_FORMAT_VERSION` when a writer
changes field semantics.

## Model builder (`io/build.ts`)

`createModelBuilder()` accumulates typed-array chunks (`appendNodes`,
`openElementShapeBlock`, `appendElements`, `addSet`, `setMetadata`, `addResult`)
used by the VTK reader and by tests when constructing models.

## Result composition

`createResultFieldFromModelResult(model, result, { id, unit, shape })` is the
narrow bridge from one parsed `ModelResultField` to the authored field accepted
by `FemViewport.setResults()`:

- `shape: "scalar"` accepts one-component node or element results;
- `shape: "vector"` accepts only an explicitly requested three-component node
  result, the supported deformation input;
- node ids map through the model node table into dense coordinate-row indices;
- element ids remain direct field indices so element picking and result values
  retain the same authored identity;
- missing rows and components are `NaN`, and duplicate, unknown, malformed, or
  unsupported identities fail with `IoError` diagnostics.

The complete supported composition is:
`parseVtk -> createElementModelFromFemModel -> heterogeneousElementParts ->
createScene -> createResultFieldFromModelResult -> setResults`.

## Adapter

| Format     | Reader     | Writer     | Notes                          |
| ---------- | ---------- | ---------- | ------------------------------ |
| VTK legacy | `parseVtk` | `writeVtk` | ASCII `UNSTRUCTURED_GRID` only |

The package root deliberately exposes only these explicit VTK entry points;
parser sessions remain internal. Supported attribute
sections include `SCALARS`, `VECTORS`, `NORMALS`, `TENSORS`, `FIELD`, and
`COLOR_SCALARS`. Unsupported `METADATA` produces an explicit error instead of
silently truncating the import. Unsupported cell types are omitted with errors;
malformed or under-delivered records produce actionable `Issue`s with stable
`code`s (see `io/diagnostics.ts`).

The separate bytes-only GLB display-scene boundary is documented in
[[data/glb-import|GLB display-scene import]]. It returns the canonical
`Scene`, not this FE `FemModel`; VTK remains the only format for FE entities,
sets, metadata, and results.

## Format capabilities

- **IDs**: VTK has implicit ids. `writeVtk` preserves coordinate row order and
  remaps authoritative node and element ids to those emitted rows; a parsed
  file therefore receives dense 0..n-1 ids, while geometry and result
  associations remain intact.
- **Cells**: Point, Line, Line3, Triangle, Tri6, Quad, Quad8, Tet4, Tet10,
  Wedge6, Pyramid5, Hex8, and Hex20 map to their canonical VTK legacy cell types
  (VTK cell types 13 and 14 for Wedge6 and Pyramid5).
- **Sets / metadata**: VTK legacy has no set or metadata concept.
- **Results**: complete node and element fields are reordered by identity to
  POINT_DATA and CELL_DATA row order. One-component fields use `SCALARS`,
  three-component fields use `VECTORS`, and nine-component fields use
  `TENSORS`. Every other positive component width uses a deterministic `FIELD`
  array, including six-component fields. Partial, duplicate, unknown, or
  non-finite fields, invalid component counts, and names that are not one
  representable VTK token fail with `VtkWriteError` rather than being omitted.
  Names containing comma or VTK comment delimiters (`#` and `!`) are rejected
  because the reader would otherwise tokenize them differently on round-trip.

The dense ids after parsing are an unavoidable VTK limitation, not a loss of
the original associations. Callers should match entities by coordinate and
connectivity position when comparing a written model with its parsed result.

## Module split

- `vtk.ts` — top-level keyword dispatch and header handling.
- `vtk-cells.ts` — POINTS / CELLS / CELL_TYPES assembly.
- `vtk-data.ts` — POINT_DATA / CELL_DATA arrays.
- `vtk-write.ts` — deterministic ASCII export.
- `vtk-write-results.ts` — result identity remapping and component-shape output.
- `session.ts` — shared parse session + `finishParse` validation.
- `validate.ts` / `diagnostics.ts` / `numbers.ts` / `growable.ts` — shared
  helpers.

## Out of scope

VTU, Gmsh, Abaqus adapters, cooperative cancellation, and progress reporting
were removed to match [[requirements/product-scope|product scope]]. Do not
re-add them without an explicit scope decision.

[architecture/source-organization|Source organization]: ../architecture/source-organization.md
[requirements/product-scope|product scope]: ../requirements/product-scope.md
