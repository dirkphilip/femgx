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
renderer changes — see [[interactive-state|Interactive state]].

## Deformation (`deform.ts`)

`deformPositions` / `deformGeometry` displace a geometry by a nodal displacement
vector field times a `scale` factor. Vertex index `i` corresponds to node index
`i` (geometry may cover a subset of nodes); missing displacements leave the
original vertex in place.

## Demo

`demo/results-fixture.ts` + `demo/results-demo.ts` render a triangulated
cantilever plate through the deterministic CPU 2D renderer:

- two load cases (bending, twist) with nodal displacement and elemental stress
  fields, von Mises derived through the library, and one intentionally missing
  stress element;
- controls for undeformed/deformed, scalar/plain coloring, a deformation scale
  slider, and load-case stepping;
- the shared color map is built from the observed range over both load cases;
  switching cases demonstrates clipping when values exceed the map range.

`e2e/results.spec.ts` exercises the demo deterministically (the default e2e lane
runs the CPU renderer) by comparing canvas pixel hashes across each toggle.

## Status / follow-ups

- GPU-side per-instance deformed rendering (per-instance vertex displacement)
  is not implemented; deformation today is computed CPU-side. Scalar colors
  already flow through the GPU per-instance color attribute.
- Animation and load-case _stepping_ are demonstrated by swapping fields in the
  demo; there is no dedicated animation API yet.

Related: [[elements-topology|Element topology]], [[fe-fixture|FE fixture]],
[[interactive-state|Interactive state]], [[architecture-overview|Architecture
overview]].
