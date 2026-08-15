# Results: fields, deformation, and visualization

Engineering analysis results are first-class CPU-side data in `src/results/`
(no WebGPU coupling), exported through the canonical `femgx` entry. They describe authored
values per node or per element and map scalar values for visualization; retaining
a vector field does not by itself enable a viewport glyph presentation.

## Result fields

`createResultField` builds a typed `ResultField<shape, location>`:

- Locations are `nodal` or `elemental`; retained result shapes are `scalar` and
  `vector`. Viewport coloring accepts authored scalar fields at either location;
  authored nodal vectors drive deformation, while authored elemental vectors can
  drive the bounded orientation glyph role.
- `values` is `count * FIELD_COMPONENT_COUNT[shape]` floats, one entity after
  another, index-aligned with the owning model's node/element numbering. The
  array is referenced (not copied) so large models stay cheap; treat it as
  immutable after construction.
- `unit` is an opaque display string ("mm", "MPa", ...); the library never
  converts units.
- Missing values are `NaN` anywhere a component is unknown. Ranges and the color
  map treat `NaN` as missing rather than as zero.
- Accessors `scalarAt` / `vectorAt` read one entity and throw on
  out-of-range indices.

Parsed VTK results enter this same authored-field path through
`createResultFieldFromModelResult`. It maps model node identities to dense
coordinate rows, keeps element ids aligned with picking, and fills absent rows
with `NaN`; it does not derive or average any engineering quantity.

## Ranges (`range.ts`)

`finiteRange` / `scalarRange` compute `{ min, max }` over finite values only,
so a range is well defined even when a field contains missing values; they
return `undefined` when nothing is finite.

## Scalar color mapping (`mapping.ts`)

`createScalarColorMap({ min, max })` builds a map over a fixed range with a
default blue-cyan-yellow-red ramp. `mapScalar`:

- clips values below/above the range to the nearest stop color,
- interpolates linearly between `stops`,
- optionally maps into discrete bands via ascending `thresholds`,
- returns `missingColor` (default gray) for `NaN`.

Mapped colors are plain `Color` values. Elemental results layer them into the
viewport's private element styles; nodal results upload one color table per part
indexed by exact one-based node pick id, and the existing tessellation
interpolates those colors on the GPU. Both paths preserve host interaction state.

## Canonical viewport workflow

`FemViewport.setResults({ scalar, deformation, vectors })` composes these
helpers into one atomic authored result snapshot. Each role is optional, but
at least one must be present. An authored scalar field may be nodal or
elemental. Nodal values map through exact node pick ids and interpolate over
existing tessellation nodes; elemental values map directly to element ids and
render flat. An omitted range is computed from finite values (constant fields
receive a small expanded range), while an explicit color map must use the same
range.

An optional nodal vector field is converted into one GPU deformation buffer per
scene part. The viewport validates that every rendered part has node pick ids and
that every referenced element/node has a field value. `vectors` accepts an
authored elemental vector field plus renderer-owned `arrow`/`axis`,
`direction`/`normal`, optional positive `lengthScale`, and optional bounded
`widthPixels` semantics. `widthPixels` is a finite CSS-pixel shaft width from
1 through 8, defaults to 2, and may be fractional; device-pixel-ratio scaling
is renderer-owned. The role does not expose anchors, records, glyph meshes, or GPU resources. All configured
roles are resolved and validated before the renderer or public state changes; a
failed replacement preserves the previous state. `clearResults()` restores the
base interaction state, disables deformation and glyphs, and leaves the
authoritative scene geometry untouched. `FemViewport.interaction` always returns the exact
host-supplied base value; result colors are an internal effective render state
and never appear in that getter or in
`ViewportResultsState`. Replacing results reuses the same scene/runtime and
only updates the effective interaction colors and deformation state.
Repeated `setResults()` calls are the host-owned snapshot-sequencing boundary:
the host may step or play an ordered collection of exact authored states while
reusing the same scene/runtime. Scalar, deformation, and vector roles change
atomically, so paired stress and displacement never expose a mixed step. For a
visually comparable sequence, the host supplies one explicit scalar range for
every snapshot rather than allowing per-snapshot automatic ranges. Derived
nodal color tables and per-part displacement arrays are reused when their
authored typed-array references are unchanged, while a scale-only deformation
change rewrites only the small deformation uniform. A new same-sized array is
written into the existing GPU storage; device recovery retains and re-uploads
only the latest active snapshot. femgx does not store a sequence, own a clock,
schedule frames, provide playback controls, or interpolate between fields.

The `results` demo preset exercises the scalar/deformation/orientation workflow
with a static 4-by-2 Hex8 block placed once directly and once through a reflected,
non-uniform occurrence. Its eight elements share the 30 nodes of one conforming
block, use dense element ids aligned directly with eight authored scalar values,
and apply a small curved/tapered nodal displacement. It also carries two
elemental fields: signed shell-normal rows (including missing and zero rows) and
sign-invariant fiber rows. This makes the demo visibly show multiple scalar bands
and repeated orientation semantics while retaining the same static viewport path:
the public API supports the undeformed/base state via `clearResults()`, the
colored state via `setResults({ scalar: { field } })`, and the combined
colored/deformed state by adding `deformation`. Vector-only and combined
vector states use the same replacement boundary.

The inspection workbench adds one demo-private result panel with scalar,
deformation, and vector field/glyph/transform/positive-length/CSS-pixel-width controls. It
describes orientation as normalized and does not display magnitude. The legend
formats the resolved viewport range and color stops without adding a public
legend subsystem; picked scalar and vector values are shown only when the hit
identity matches the field's authored location. The opt-in WebGPU benchmark
matrix includes a structured Hex8 orientation case and reports its existing
`vector-glyph` draw/write counters.

### Elemental orientation vectors

The implemented orientation slice reuses `VectorField<"elemental">` for
authored normals and fiber directions. It is a viewport-owned, orthogonal
result role rather than a second field model or result manager, with
`clearResults()` remaining the explicit empty transition. The data, transform,
anchor, instancing, depth, and interaction contract is recorded in
[[data/vector-field-visualization|Authored elemental orientation visualization]];

## Deformation (`deform.ts`)

`deformPositions(positions, nodePickIds, displacements, scale)` / `deformGeometry(geometry,
displacements, scale)` displace a geometry by a nodal displacement vector field times a `scale`
factor. Vertices are mapped back to their model node through the per-vertex `nodePickIds` map
(`nodeId + 1`, `0` = vertex without a node), so indexed tessellated geometry deforms through its
authored FE nodes instead of assuming vertex `i` is node `i`. The same mapping also supports
custom geometry that deliberately duplicates a source node at multiple output vertices.
Vertices without a node, without a matching displacement, or whose displacement is missing
(`NaN`) keep their original position. `deformGeometry` requires a node-mapped geometry
(`elementPart` provides one for element-backed geometry) and throws otherwise.

`nodalDisplacements(nodeCount, field)` builds the per-node displacement buffer consumed by the
GPU renderer's deformed-shape path: one vec3 per model node indexed by `NodeId`. Pass the owning
model's node count (the largest node id used by the part's vertices plus one). `NaN`/missing values
are zeroed so the node stays put. Feed it into
the renderer's `setDeformation` state for one part.

## GPU deformed shapes (`gpu-deform.ts`)

The WebGPU renderer displaces vertices on the GPU without rebuilding geometry:

- `renderer.setDeformation({ scale, displacements })`
  sets the per-frame deformation state; `render()` rewrites the small
  deformation uniform (scale plus alignment padding) every frame and uploads each
  part's displacement buffer once, reusing it until the array reference changes.
- `displacements` is a `ReadonlyMap<PartId, Float32Array>`; each buffer holds
  `nodeCount * 3` floats indexed by `NodeId` (build them with
  `nodalDisplacements`). An absent state disables deformation.
- The WGSL vertex shaders (`gpu-shaders.ts`) resolve each vertex to its FE node through the
  part's per-vertex node pick ids and add `displacement * scale` to the model-space vertex in
  the triangle, point-sprite, and edge-overlay passes, so the wireframe and picking stay
  aligned with the deformed solid. Supported Line3, Tri6, Quad8, Tet10, and Hex20 tessellation
  vertices are all authored nodes, so no quadratic face center can remain stationary.
- Geometry upload stays amortized: only the tiny uniform (and a compact displacement buffer on load-case change) is rewritten, matching the delta-oriented architecture — see [[rendering/renderer-subrange-updates|Renderer subrange updates]].

## Status / follow-ups

- Results are rendered through the WebGPU renderer; the former CPU-canvas demo
  was removed to retain the WebGPU-only product contract. Static viewport
  composition is the supported results path.
- Host-driven sequencing of exact authored snapshots is supported through
  repeated `setResults()` calls. The former library-owned `CasePlayer`, temporal
  interpolation, and public legend helpers remain out of product scope.

Related: [[data/elements-topology|Element topology]], [[data/fe-fixture|FE fixture]],
[[data/vector-field-visualization|Authored elemental orientation visualization]],
[[rendering/interactive-state|Interactive state]], [[architecture/architecture-overview|Architecture
overview]].

[data/elements-topology|Element topology]: elements-topology.md
[data/fe-fixture|FE fixture]: fe-fixture.md
[data/vector-field-visualization|Authored elemental orientation visualization]: vector-field-visualization.md
[rendering/interactive-state|Interactive state]: ../rendering/interactive-state.md
[rendering/renderer-subrange-updates|Renderer subrange updates]: ../rendering/renderer-subrange-updates.md
