# FE fixture

The demo fixtures under `demo/fixture/` are deterministic, CPU-only model
builders used to exercise the WebGPU path and unit tests.

## Element gallery

`createElementFixture` places one reusable example for every currently
supported shape: Point, Line, Line3, Triangle, Quad, Tet4, Tet10, Hex8, and
Hex20. It also includes a concave polygon authored through the geometry-owned
`polygonPart` path. Filled modes share the surface and volume parts; point and
line parts remain as overlays. The gallery is intentionally explicit about
quadratic shapes so the tessellated surface is inspectable without introducing
another renderer or API.

## VTK sample

`demo/fixture/sample-block.vtk` is a checked-in ASCII legacy VTK unstructured
grid containing four Hex8 cells, nodal temperature data, and elemental stress
data. `createVtkFixture` parses it through the public `parseVtk` path and turns
the imported element block into the demo's reusable solid/surface/edge parts.
This is the demo's small real-file import smoke fixture; VTK remains the only
interchange format in product scope.

## Hex20 cylinder

`createHex20CylinderFixture` builds a small 12-sector, two-ring annular
cylinder from Hex20 cells. Circumferential mid-edge nodes lie on the circular
arc rather than at the chord midpoint, and the fixture requests four quadratic
edge segments so the curved tessellation is visible with the demo edge overlay.

## Bolted plate assembly

`createBoltedPlateFixture` builds the default showcase: two overlapping plates
clamped by eight fasteners. Four reusable components are tessellated for solid,
surface, and edge modes (12 parts total); nested assembly definitions reuse the
same bolt, washer-pair, and nut definitions at every fastener location.

The deterministic defaults span X `-15..21`, Y `-4..4.35`, and Z `-7..7`, with
34 visible part instances in the solid mode. The preset is the landing view, so
changes to these defaults require matching e2e updates.

## Removed demo fixtures

The broken portal-frame and stiffened-deck-panel presets were removed from the
demo, along with their fixture modules and tests. They did not represent a
supported user workflow and left dead code behind after the demo shifted toward
the VTK import and element-topology examples.

Related: [[data/elements-topology|Element topology]],
[[data/io-import-export|IO import/export]],
[[rendering/element-rendering|Element rendering]].

[data/elements-topology|Element topology]: elements-topology.md
[data/io-import-export|IO import/export]: io-import-export.md
[rendering/element-rendering|Element rendering]: ../rendering/element-rendering.md
