# Camera presentation

The demo uses a perspective-first isometric pose so the wide element gallery
fits without the compressed look of a near orthographic camera. Perspective
framing is calculated from the fixture bounds and viewport aspect ratio.

Projection changes preserve vertical framing: converting from perspective derives
an orthographic height from camera distance, while converting back derives a
distance from that height. This avoids the apparent zoom jump that previously made
the perspective toggle look broken. See [[rendering/interactive-state|Interactive state]] for the related
interaction model and [[rendering/element-rendering|Element rendering]] for the demo geometry modes.

The public `installCameraControls` helper follows SpaceClaim's default mouse navigation: middle-drag spins,
Shift+middle-drag pans, Ctrl+middle-drag zooms vertically, and the wheel zooms
toward the orbit target. Spin uses the closest visible GPU-picked face
under its start point as the rotation pivot; `WebGpuRenderer.pickPoint`
reads the winning fragment's NDC depth and unprojects the exact displayed world
position. This follows GPU deformation and non-planar tessellation instead of
reconstructing an undeformed CPU face plane.
Empty space falls back to the fitted model target. Early drag deltas wait for
the asynchronous GPU hit, so the gesture uses one pivot from its first visible
movement onward. The WebGPU renderer projects its active pivot to an
always-visible, high-contrast screen-space target at that world-space position. Spin is
continuous through the poles, and both spin and pan use the SpaceClaim
direction convention. Left-drag is reserved for selection, including its
shift-based inspection modifiers. The demo presentation uses a light studio
background and restrained material colors so geometry edges and selection
emphasis remain legible.
