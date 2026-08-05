# IO: streaming import/export adapters

The `src/io/` subsystem makes femgx usable with real engineering models
through a versioned typed interchange model and format adapters. See also
[[architecture/source-organization|Source organization]] for the directory convention and [[engineering/quality-gate|Quality gate]] for
coverage expectations.

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

## Chunked builder (`io/build.ts`)

`createModelBuilder()` accumulates typed-array chunks (`appendNodes`,
`openElementBlock`, `appendElements`, `addSet`, `setMetadata`, `addResult`).
Parsers flush bounded batches, so a whole model is never materialized as
arrays of JS objects — this is how large fixtures load in constant memory.

## Adapters

| Format        | Reader        | Writer        | Notes                                           |
| ------------- | ------------- | ------------- | ----------------------------------------------- |
| VTK legacy    | `parseVtk`    | `writeVtk`    | ASCII `UNSTRUCTURED_GRID` only                  |
| VTK XML (VTU) | `parseVtu`    | `writeVtu`    | ASCII data arrays only                          |
| Gmsh MSH      | `parseGmsh`   | `writeGmsh`   | MSH 2.2 ASCII only                              |
| Abaqus        | `parseAbaqus` | `writeAbaqus` | input deck, `*NODE`/`*ELEMENT`/`*NSET`/`*ELSET` |

All readers share a `ParseSession` (`io/session.ts`) with typed diagnostics,
cooperative cancellation, and progress reporting. `parse()`/`write()` dispatch
by `IoFormat`. Unknown keywords/sections are skipped; unsupported cell types
produce warnings and are omitted; malformed records produce actionable
`Issue`s with stable `code`s (see `io/diagnostics.ts`). Malformed
`$NodeData`/`$ElementData` blocks report `bad-data-count`, `bad-data-line`, or
`data-shape` and are dropped with a `dropped-data-block` warning rather than
vanishing silently.

## Format capabilities and round-trip contract

- **IDs**: Gmsh and Abaqus carry real node/element ids and round-trip
  arbitrary ids. VTK/VTU have implicit ids, so they round-trip the canonical
  contiguous 0..n-1 domain only.
- **Sets**: Gmsh physical groups ↔ element sets; Abaqus `*NSET`/`*ELSET` ↔
  node/element sets; VTK/VTU have no set concept.
- **Metadata**: VTU `FieldData` round-trips metadata (string/number/boolean
  via the `femgx-type` attribute); other formats have no metadata concept.
- **Results**: Gmsh `$NodeData`/`$ElementData` preserve arbitrary ids; VTK/VTU
  export results only when ids are the contiguous entity sequence (their
  native domain).

## Quadratic node ordering translation

The library's canonical connectivity (see
[[data/elements-topology|Element topology]]) follows the VTK convention:
corners first, then mid-edge nodes in canonical edge order. Gmsh lists the
mid-edge nodes of quadratic elements in a different order, so the gmsh
adapters translate connectivity at the format boundary
(`src/io/gmsh-order.ts`):

- **Gmsh Tet10** (type 11) — only the last two mid-edge slots are swapped:
  gmsh slot 8 lies on `{2,3}` and slot 9 on `{1,3}`, the reverse of the
  canonical order. Both directions use the permutation
  `[0,1,2,3,4,5,6,7,9,8]`.
- **Gmsh Hexahedron20** (type 17) — gmsh's mid-edge order differs from VTK on
  nearly every edge (e.g. gmsh slot 18 lies on `{5,6}` and slot 19 on
  `{6,7}`, which are canonical slots 13 and 14). The permutations are derived
  from the gmsh edge list and match meshio's gmsh↔VTK permutations
  (`_gmsh_to_meshio_order` / `_meshio_to_gmsh_order`).
- **Line3, and all linear shapes** — gmsh orders them identically to the
  canonical ordering, so no translation is applied.

**Abaqus needs no translation**: its `C3D10` and `C3D20` connectivity already
matches the canonical VTK ordering (verified against the Abaqus/CalculiX
convention — the C3D20 mid-edge nodes run bottom face 9-12, top face 13-16,
vertical 17-20 = canonical slots 8-19). The intermediate Hex20 edge-order
regression from #66/#92 that made Abaqus appear to swap slots 18/19 was a bug
in `src/elements/shapes.ts` itself and was fixed there; the adapters were
never the problem. `test/io/gmsh-order.test.ts` and the abaqus quadratic tests
pin the mid-edge placement with known coordinates for both formats.

## Known limitations (deliberate, documented)

- Binary VTK, binary/appended VTU, and Gmsh MSH 4.x are rejected with a clear
  diagnostic rather than silently mis-parsed.
- VTK/VTU cannot express arbitrary ids or sets, so round-tripping a hand-built
  model with non-contiguous ids through those formats loses the ids.
- Cell results in VTK/VTU align to cell index; skipped unsupported cells make
  the corresponding result ids missing, which validation reports.

## Module layout

Readers are split into focused files to stay under the `max-lines` budget:

- `growable.ts` — shared growable `Uint32Buffer`/`Float64Buffer` typed-array
  backing stores used by the chunked builder and the VTK legacy reader so
  intermediate connectivity/type/value tables stay compact (never boxed JS
  numbers) even when a full section is buffered before assembly.
- `vtk.ts` (state + dispatch) / `vtk-cells.ts` (points, cells, types) /
  `vtk-data.ts` (attribute arrays and results).
- `gmsh.ts` (sections) / `gmsh-scan.ts` (nodes + elements) /
  `gmsh-data.ts` (`$NodeData`/`$ElementData`).
- `abaqus.ts` (keywords + dispatch) / `abaqus-read.ts` (data lines + type map).
