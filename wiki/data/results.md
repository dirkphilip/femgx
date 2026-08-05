# Results: fields, deformation, and scalar visualization

Engineering analysis results are first-class CPU-side data in `src/results/`
(no WebGPU coupling), exported through `src/index.ts`. They describe values per
node or per element and derive scalar quantities for visualization.

## Result fields

`createResultField` builds a typed `ResultField<shape, location>`:

- Locations are `nodal` or `elemental`; shapes are `scalar`, `vector`, or
  `tensor` (a symmetric 3x3 in Voigt order `[xx, yy, zz, xy, yz, zx]`).
- `values` is `count * FIELD_COMPONENT_COUNT[shape]` floats, one entity after
  another, index-aligned with the owning model's node/element numbering. The
  array is referenced (not copied) so large models stay cheap; treat it as
  immutable after construction.
- `unit` is an opaque display string ("mm", "MPa", ...); the library never
  converts units and derived fields inherit the source unit.
- Missing values are `NaN` anywhere a component is unknown. Derived quantities,
  ranges, and the color map all skip or propagate `NaN` rather than treating it
  as zero.
- Accessors `scalarAt` / `vectorAt` / `tensorAt` read one entity and throw on
  out-of-range indices.

## Derived quantities (`derived.ts`)

- `magnitude` / `tensorMagnitude` — vector length and tensor Frobenius norm.
- `vonMises` — von Mises equivalent stress of a symmetric stress tensor.
- `principalValues` — eigenvalues of a symmetric 3x3 tensor, sorted descending,
  via the analytic trigonometric (Cardano) solution; exact for diagonal tensors
  and NaN-safe. `principals` returns all three per entity; `maxPrincipalField`
  exposes the largest.
- Field-level helpers return `Float32Array`s (`magnitudes`, `vonMisesValues`,
  `principals`) and field builders (`magnitudeField`, `vonMisesField`,
  `maxPrincipalField`) that keep the source location and unit.

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

`legend` returns labeled `LegendEntry`s (one per stop, or one per band) for
rendering a color bar, and the demo draws a gradient plus a gray missing
swatch. Mapped colors are plain `Color` values, so they feed the existing
per-instance GPU color attribute path (via interaction style overrides) without
renderer changes — see [[rendering/interactive-state|Interactive state]].

## Deformation (`deform.ts`)

`deformPositions(positions, nodePickIds, displacements, scale)` / `deformGeometry(geometry,
displacements, scale)` displace a geometry by a nodal displacement vector field times a `scale`
factor. Vertices are mapped back to their model node through the per-vertex `nodePickIds` map
(`nodeId + 1`, `0` = interpolated), so tessellated geometry that duplicates vertices per
triangle/segment deforms like its FE nodes instead of assuming vertex `i` is node `i`.
Vertices without a node, without a matching displacement, or whose displacement is missing
(`NaN`) keep their original position. `deformGeometry` requires a node-mapped geometry
(`elementGeometry`/`elementPart` always provide one) and throws otherwise.

`nodalDisplacements(nodeCount, cases)` builds the per-node displacement buffer consumed by the
GPU renderer's deformed-shape path: one vec3 per model node per load case, load-case major
(`[case 0 node 0, case 0 node 1, ..., case 1 node 0, ...]`) and indexed by `NodeId`. Pass the
owning model's node count (the largest node id used by the part's vertices plus one). `NaN`/
missing values are zeroed so the node stays put. Feed it into
`DeformationState.displacements` for one part.

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
  aligned with the deformed solid. Interpolated tessellation vertices (e.g. quadratic quad
  centers) have no node and stay in place.
- Geometry upload stays amortized: only the tiny uniform (and a compact displacement buffer on load-case change) is rewritten, matching the delta-oriented architecture — see [[rendering/renderer-subrange-updates|Renderer subrange updates]].

## Load-case playback (`case-player.ts`)

`createCasePlayer(cases, options)` builds an immutable `CasePlayer` over an
ordered list of nodal displacement fields (validated to share a count and unit).
`advanceCase(player, deltaSeconds)` advances playback in time and returns a new
player: `caseIndex` moves through the cases, wrapping back to the first by
default or clamping at the last (`loop: "wrap" | "clamp"`), and `caseDuration`
controls the seconds per case. `sampleDisplacements(player)` serves the active
displacement field — the source field directly when not blending, or a
component-wise linear blend into the next case when `interpolate` is enabled.
`nextCaseIndex`/`blend` expose the transition so consumers can keep other
per-case data (stresses, derived fields) in sync.

The player is delta-oriented: it only selects and serves the active fields and
never rebuilds geometry, so per-frame stepping is a cheap index/time update
plus an optional interpolated field. `NaN` components propagate through the
blend, matching the field conventions.

## Demo

`demo/results-fixture.ts` + `demo/results-demo.ts` render a cantilever plate
through the deterministic CPU 2D renderer. The mesh is tessellated by the FE
geometry builder (`elementGeometry`, one degenerate tet per grid cell), so the
demo deforms it through the node-mapped CPU path rather than a hand-built
node-aligned vertex buffer:

- two load cases (bending, twist) with nodal displacement and elemental stress
  fields, von Mises derived through the library, and one intentionally missing
  stress element;
- controls for undeformed/deformed, scalar/plain coloring, a deformation scale
  slider, manual load-case stepping, and a play/pause loop that advances cases
  over time via the case player with interpolated deformation;
- the shared color map is built from the observed range over both load cases;
  switching cases demonstrates clipping when values exceed the map range.

`e2e/results.spec.ts` exercises the demo deterministically (the default e2e lane
runs the CPU renderer) by comparing canvas pixel hashes across each toggle, and
covers playback by observing the case index and blend progress advance.

## Status / follow-ups

- GPU-side per-instance deformed rendering is implemented; the results demo
  still uses the deterministic CPU renderer. Wiring the demo's scale/load-case
  controls to `setDeformation` (optionally through `CasePlayer` interpolation
  served as a one-case displacement buffer) is a follow-up.
- Load-case playback and displacement interpolation are provided by the
  `CasePlayer` API and demonstrated in the demo.

Related: [[data/elements-topology|Element topology]], [[data/fe-fixture|FE fixture]],
[[rendering/interactive-state|Interactive state]], [[architecture/architecture-overview|Architecture
overview]].
