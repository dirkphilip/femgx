# IO: host-supplied FE model ingestion

The `src/io/` subsystem owns the serializable `FemModel` staging boundary,
validation, diagnostics, and conversion into the in-memory FE authoring and
authored-results paths. It does not read or write solver files.

## Model boundary (`src/io/fem-model.ts`)

`FemModel` is a versioned, fully serializable host payload:

- `nodes` — `ids: Uint32Array` plus `coordinates: Float64Array` (three per node);
- `elementShapeBlocks` — rows grouped by `ElementShape`, with ids unique across
  blocks;
- `sets` — named node or element id groups;
- `metadata` — string-keyed values with insertion order preserved; and
- `results` — named node or element fields with explicit component counts.

Every array is typed and every value is a plain object, so a `FemModel` is
straightforward to validate, transfer, and serialize. Bump
`FEMGX_FORMAT_VERSION` when the meaning of an existing field changes.

The double-precision coordinate table belongs to this host payload. Conversion
through `createElementModelFromFemModel` produces the product's
single-precision render model directly; see
[[data/elements-topology|Element topology]].

## Model builder (`src/io/model-builder.ts`)

`createModelBuilder()` accumulates typed-array chunks through
`appendNodes`, `openElementShapeBlock`, `appendElements`, `addSet`,
`setMetadata`, and `addResult`. `build()` returns one immutable `FemModel`.
The builder is useful for hosts and adapters that already own their ingestion
boundary; it does not perform file discovery, transport, or background loading.

## Validation and conversion

`validateModel(model)` returns typed `Issue` records for malformed node tables,
duplicate identities, invalid connectivity, unknown set/result references, and
unsupported result shapes. `createElementModelFromFemModel(model)` validates
the payload and then creates the dense `ElementModel` consumed by
`elementPart`; node ids must already be dense and in coordinate order.
Hosts retain direct body ownership in that same conversion by passing
validated `bodies`, avoiding a second full model build and copy. The copyable
[`examples/host-integration`](../../examples/host-integration/README.md) shows
the complete sparse-host-id to dense-ordinal boundary and reverse mapping.

`createResultFieldFromModelResult(model, result, { id, unit, shape })` is the
narrow bridge from one host-authored result to the viewport:

- scalar results may be nodal or elemental;
- vector results are limited to explicit three-component nodal data for
  deformation;
- node ids map through the model node table into dense coordinate-row indices;
- element ids remain direct field indices so picking stays aligned; and
- missing rows become `NaN`, while duplicate, unknown, malformed, or
  unsupported identities fail with `IoError` diagnostics.

The complete FE handoff is:
`FemModel -> validateModel -> createElementModelFromFemModel -> elementPart ->
Scene -> Viewport`, with authored results converted through
`createResultFieldFromModelResult` before `setResults()`.

## Display-scene import

The separate bytes-only GLB boundary is documented in
[[data/glb-import|GLB display-scene import]]. It returns the canonical `Scene`
and never creates FE identities, result fields, or a parallel scene graph.

## Out of scope

Solver file readers and writers, replacement interchange formats, compatibility
aliases, migration layers, transport, cancellation, and progress reporting are
outside this subsystem. Add such a capability only after an explicit product
scope decision.

[architecture/source-organization|Source organization]: ../architecture/source-organization.md
[data/elements-topology|Element topology]: elements-topology.md
[data/glb-import|GLB display-scene import]: glb-import.md
[requirements/product-scope|Product scope]: ../requirements/product-scope.md
