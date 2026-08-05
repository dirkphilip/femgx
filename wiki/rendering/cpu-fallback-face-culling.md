# CPU fallback face culling

The demo's CPU (2D canvas) fallback draws solid-mode triangle geometry per
element as one filled path. Early on this made thin solids vanish: a single
`fill()` path mixes front and back faces, and the canvas **nonzero fill rule
cancels overlapping opposite-wound subpaths**. A thin plate seen at a shallow
angle projects its bottom (back) faces over the top (front) faces, so the whole
solid rasterized to nothing.

The WebGPU lane never hit this because its solid pipeline uses
`cullMode: "back"`.

## Fix

`demo/cpu-render.ts` (`drawTriangles`) now culls back faces in screen space
before adding a triangle to the path: skip triangles whose projected
screen-space signed area is non-positive, matching the WebGPU back-face cull.
This is both correct and faster (roughly half the fills). The portal-frame and
bolted-plate presets rely on it; e2e smoke/screenshot assertions cover the
bolted showcase.

Related: [[rendering/fe-inspection-workbench|FE inspection workbench]],
[[data/fe-fixture|FE fixtures]].
