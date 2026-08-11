# Camera presentation

The demo uses a perspective-first isometric pose so the wide element gallery
fits without the compressed look of a near orthographic camera. Perspective
framing is calculated from all eight bounds corners and the viewport aspect
ratio. `fitCamera` preserves the current view direction/up vector, retargets to
the bounds center, and solves a 90% frame margin for perspective distance or
orthographic height. The same policy serves fit-to-view, preset changes, reset,
and fit-to-selection; no preset-specific distance is needed.

Projection changes preserve vertical framing: converting from perspective derives
an orthographic height from camera distance, while converting back derives a
distance from that height. This avoids the apparent zoom jump that previously made
the perspective toggle look broken. See [[rendering/interactive-state|Interactive state]] for the related
interaction model and [[rendering/element-rendering|Element rendering]] for the demo geometry modes.

The public `installCameraControls` helper follows SpaceClaim's default mouse navigation: middle-drag spins,
Shift+middle-drag pans, Ctrl+middle-drag zooms vertically, and the wheel zooms
toward the visible point under the cursor. Spin uses the closest visible GPU-picked face
under its start point as the rotation pivot; `WebGpuRenderer.pickPoint`
reads the winning fragment's NDC depth and unprojects the exact displayed world
position. This follows GPU deformation and non-planar tessellation instead of
reconstructing an undeformed CPU face plane.
Empty space falls back to the fitted model target. Wheel zoom uses the picked
world point as a scale pivot, preserving its screen position while zooming.
Early drag deltas wait for
the asynchronous GPU hit, so the gesture uses one pivot from its first visible
movement onward. The WebGPU renderer projects its active pivot to a
high-contrast three-axis screen-space widget at that world-space position. The X/Y/Z
directions follow the current camera projection, while the widget dimensions scale
with device pixels and stay stable through perspective, orthographic, and resize changes.
The widget is visible only while the orbit gesture is active. Spin is
continuous through the poles, and both spin and pan use the SpaceClaim
direction convention. Left-drag is reserved for selection, including its
shift-based inspection modifiers. The demo presentation uses a light studio
background and restrained material colors so geometry edges and selection
emphasis remain legible. Its lower-left orientation gizmo follows the camera's
screen-space world-axis projection, and pressing `Z` fits the selected visible
occurrences (or the complete scene when there is no selection).
