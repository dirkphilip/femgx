# Results: fields, deformation, and scalar visualization

Engineering analysis results are first-class CPU-side data in `src/results/`
(no WebGPU coupling), exported through `src/index.ts`. They describe values per
node or per element and map authored scalar values for visualization.

## Result fields

`createResultField` builds a typed `ResultField<shape, location>`:

- Locations are `nodal` or `elemental`; retained result shapes are `scalar` and
  `vector`. Viewport coloring accepts authored scalar fields at either location;
  authored nodal vectors remain the deformation input.
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

`FemViewport.setResults({ field, range, colorMap, deformation })` composes these
helpers into the supported static visualization path. An authored scalar field
may be nodal or elemental. Nodal values map through exact node pick ids and
interpolate over existing tessellation nodes; elemental values map directly to
element ids and render flat. An omitted range is computed from finite values
(constant fields receive a small expanded range), while an explicit color map
must use the same range.

An optional nodal vector field is converted into one GPU deformation buffer per
scene part. The viewport validates that every rendered part has node pick ids and
that every referenced element/node has a field value. `clearResults()` restores
the base interaction state, disables deformation, and leaves the authoritative
scene geometry untouched. `FemViewport.interaction` always returns the exact
host-supplied base value; result colors are an internal effective render state
and never appear in that getter or in
`ViewportResultsState`. Replacing results reuses the same scene/runtime and
only updates the effective interaction colors and deformation state.

The `results` demo preset exercises this workflow with a static 4-by-2 Hex8 stress
strip. Its eight elements share the 30 nodes of one conforming block, use dense
element ids aligned directly with eight authored scalar values, and apply a small
curved/tapered nodal displacement. This makes the `results` demo visibly show
multiple scalar bands while retaining the same static viewport path:
the public API supports the undeformed/base state via `clearResults()`, the
colored state via `setResults({ field })`, and the combined colored/deformed
state by adding `deformation`.

## Deformation (`deform.ts`)

`deformPositions(positions, nodePickIds, displacements, scale)` / `deformGeometry(geometry,
displacements, scale)` displace a geometry by a nodal displacement vector field times a `scale`
factor. Vertices are mapped back to their model node through the per-vertex `nodePickIds` map
(`nodeId + 1`, `0` = vertex without a node), so indexed tessellated geometry deforms through its
authored FE nodes instead of assuming vertex `i` is node `i`. The same mapping also supports
custom geometry that deliberately duplicates a source node at multiple output vertices.
Vertices without a node, without a matching displacement, or whose displacement is missing
(`NaN`) keep their original position. `deformGeometry` requires a node-mapped geometry
(`heterogeneousElementParts` provides one for element-backed geometry) and throws otherwise.

`nodalDisplacements(nodeCount, cases)` builds the per-node displacement buffer consumed by the
GPU renderer's deformed-shape path: one vec3 per model node per load case, load-case major
(`[case 0 node 0, case 0 node 1, ..., case 1 node 0, ...]`) and indexed by `NodeId`. Pass the
owning model's node count (the largest node id used by the part's vertices plus one). `NaN`/
missing values are zeroed so the node stays put. Feed it into
the renderer's `setDeformation` state for one part.

## GPU deformed shapes (`gpu-deform.ts`)

The WebGPU renderer displaces vertices on the GPU without rebuilding geometry:

- `renderer.setDeformation({ scale, loadCase, loadCaseCount, displacements })`
  sets the per-frame deformation state; `render()` rewrites the small
  deformation uniform (scale + active load case) every frame and uploads each
  part's displacement buffer once, reusing it until the array reference changes.
- `displacements` is a `ReadonlyMap<PartId, Float32Array>`; each buffer holds
  `loadCaseCount * nodeCount * 3` floats indexed by `NodeId` (build them with
  `nodalDisplacements`). `loadCaseCount` of 0 disables deformation.
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
- Load-case playback (`CasePlayer`), interpolation, and legend helpers were
  removed as out of product scope.

Related: [[data/elements-topology|Element topology]], [[data/fe-fixture|FE fixture]],
[[rendering/interactive-state|Interactive state]], [[architecture/architecture-overview|Architecture
overview]].

[data/elements-topology|Element topology]: elements-topology.md
[data/fe-fixture|FE fixture]: fe-fixture.md
[rendering/interactive-state|Interactive state]: ../rendering/interactive-state.md
[rendering/renderer-subrange-updates|Renderer subrange updates]: ../rendering/renderer-subrange-updates.md
