# FE fixture

The demo fixtures under `demo/fixture/` are deterministic, CPU-only model
builders used to exercise the WebGPU path and unit tests.

## Element tessellation and mapping gallery

`createElementFixture` places representative examples for the built-in topology
helpers: Point, Line, Line3, Triangle, Tri6, Quad, Quad8, Tet4, Tet10, Hex8,
and Hex20. These names describe FEMGX's typed tessellation helpers, not an
exhaustive solver-element catalog.

The gallery also includes a **Generic solver-mapped element**: temporary
solver-style node and face records are converted through the generic
`polygonPart` input into one indexed-triangle `Part` with element `42`, five
oriented face identities, one non-triangular face, and body ownership. The source
records are discarded after conversion; the scene retains only the renderer-ready
part and the presentation metadata needed by the workbench. Face and element
picks therefore demonstrate the same retained identity contract available to a
host that maps a solver representation into FEMGX.

The twelve examples use a deterministic 2-row × 6-column comparison grid:
Point, Line, Line3, Triangle, Quad, and Tri6 occupy the first row; the generic
mapped element, Tet4, Tet10, Hex8, Hex20, and Quad8 occupy the second. The
hardware-WebGPU rendering suite isolates Tri6 and Quad8, checks their exact face,
element, and authored mid-edge node identities, and repeats the checks at the
390×844 mobile viewport. Triangle, line, and point outputs remain separate only
where WebGPU primitive topology requires it; edge display is a renderer-owned
overlay.

## VTK sample

`demo/fixture/sample-block.vtk` is a checked-in ASCII legacy VTK unstructured
grid containing four Hex8 cells, nodal temperature data, elemental stress data,
and a nodal displacement vector. `createVtkFixture` parses it through the
public `parseVtk` path, converts the imported stress and displacement through
`createResultFieldFromModelResult`, and turns the imported shape block into
one reusable exterior triangle part.
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
