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

The public `installCameraControls` helper uses middle-drag to spin,
Ctrl/Meta+middle-drag to pan in the drag direction, Shift+middle-drag to zoom vertically, and the wheel to zoom
toward the visible point under the cursor. Spin uses the closest visible GPU-picked face
under its start point as the rotation pivot; the renderer's camera-navigation pick-point seam
reads the winning fragment's NDC depth and unprojects the exact displayed world
position. This follows GPU deformation and non-planar tessellation instead of
reconstructing an undeformed CPU face plane.
Empty space uses the point under the cursor on the view-aligned plane through the
camera target. Wheel zoom uses the picked world point when available and this
target-plane point otherwise, preserving the chosen screen position while
zooming. Shift+middle-drag captures the same anchor at pointer-down; pinch
recomputes it under the current two-pointer midpoint after midpoint pan.
All control-driven zoom and orbit transitions are admitted against the current
compiled scene bounds. Empty-space wheel, Shift+middle, and pinch gestures stop
at the conservative front-of-model pose. A GPU-picked displayed point becomes
the local approach limit for wheel and Shift+middle, allowing close inspection
past empty AABB corners while keeping that point in front of the near plane.
Every accepted transition recomputes a finite clip interval from the live
positive scene depths. Orbit admission searches the requested yaw/pitch as one
immutable prefix and uses the live bounds supplier when queued GPU-pivot input
resolves; standalone controls without bounds retain generic orbit behavior.
Early drag deltas wait for
the asynchronous GPU hit, so the gesture uses one pivot from its first visible
movement onward. The WebGPU renderer projects its active pivot to a
high-contrast three-axis screen-space widget at that world-space position. The X/Y/Z
directions follow the current camera projection, while the widget dimensions scale
with device pixels and stay stable through perspective, orthographic, and resize changes.
The widget is visible only while the orbit gesture is active. Spin is
continuous through the poles: orbit rotates the eye, target, and orthonormal
view-frame up direction as one rigid basis, so the view never needs a pole
clamp or a singular-frame fallback. Both spin and pan use the SpaceClaim
direction convention. Left-drag is reserved for selection, including its
shift-based inspection modifiers. The demo presentation uses a light studio
background and restrained material colors so geometry edges and selection
emphasis remain legible. Its lower-left orientation gizmo follows the camera's
screen-space world-axis projection, and pressing `Z` fits the selected visible
occurrences (or the complete scene when there is no selection).

Camera admission through `createCamera` and `FemViewport.setCamera` rejects
non-finite vectors/scalars, degenerate view bases, invalid field of view or
clip ranges, and incomplete viewport dimensions. Camera transitions reject
non-finite deltas and pivots; finite zero/negative resize values normalize to
one pixel at the resize boundary. The internal validation is centralized in
the camera subsystem and is not a public assertion API.

[rendering/element-rendering|Element rendering]: element-rendering.md
[rendering/interactive-state|Interactive state]: interactive-state.md
