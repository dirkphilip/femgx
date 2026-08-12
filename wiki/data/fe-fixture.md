# FE fixture

The demo fixtures under `demo/fixture/` are deterministic, CPU-only model
builders used to exercise the WebGPU path and unit tests.

## Element gallery

`createElementFixture` places one reusable example for every currently
supported shape: Point, Line, Line3, Triangle, Quad, Tet4, Tet10, Hex8, and
Hex20. It also includes a concave polygon authored through the geometry-owned
`polygonPart` path. Triangle, line, and point outputs remain separate only where
WebGPU primitive topology requires it; edge display is a renderer-owned overlay.
The gallery is intentionally explicit about quadratic shapes so their linear
mid-edge tessellation is inspectable without introducing another renderer or
API.

The ten examples use a deterministic 2-row × 5-column comparison grid: Point,
Line, Line3, Triangle, and Quad occupy the first row; Polygon, Tet4, Tet10,
Hex8, and Hex20 occupy the second. The explicit layout keeps each topology
readable after camera fitting at desktop and phone-sized viewports.

## VTK sample

`demo/fixture/sample-block.vtk` is a checked-in ASCII legacy VTK unstructured
grid containing four Hex8 cells, nodal temperature data, and elemental stress
data. `createVtkFixture` parses it through the public `parseVtk` path and turns
the imported element block into one reusable exterior triangle part.
This is the demo's small real-file import smoke fixture; VTK remains the only
interchange format in product scope.

## Hex20 cylinder

`createHex20CylinderFixture` builds a small 12-sector, two-ring annular
cylinder from Hex20 cells. Circumferential mid-edge nodes lie on the circular
arc rather than at the chord midpoint; the compiler uses those authored nodes
as straight linear facet vertices, so the result is a deterministic faceted
approximation with no curved interpolation.

## Bolted plate assembly

`createBoltedPlateFixture` builds the default showcase: two overlapping plates
clamped by eight fasteners. Four reusable component parts are shared by the
nested assembly definitions at every fastener location; edge display is a
renderer-owned overlay rather than duplicate geometry.

The deterministic defaults span X `-15..21`, Y `-4..4.35`, and Z `-7..7`, with
34 visible part instances in the default view. The preset is the landing view, so
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
