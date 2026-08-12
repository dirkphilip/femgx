# Camera presentation

The demo starts in an orthographic isometric pose so the wide element gallery
reads as a dimensionally stable CAD view. Perspective remains an explicit
supported mode. Framing is calculated from all eight bounds corners and the
viewport aspect ratio. `fitCamera` preserves the current view direction/up
vector, retargets to the bounds center, and solves a 90% frame margin for
perspective distance or orthographic height. The same policy serves fit-to-view,
preset changes, reset, and fit-to-selection; no preset-specific distance is
needed.

Projection changes preserve vertical framing: converting from perspective derives
an orthographic height from camera distance, while converting back derives a
distance from that height. This avoids the apparent zoom jump that previously made
the perspective toggle look broken. See [[rendering/interactive-state|Interactive state]] for the related
interaction model and [[rendering/element-rendering|Element rendering]] for the demo geometry modes.

The public `installCameraControls` helper uses middle-drag to spin,
Ctrl/Meta+middle-drag to pan in the drag direction at the target plane's
CSS-pixel scale, Shift+middle-drag to zoom vertically, and the wheel to zoom
around the current stable target. Spin uses the closest visible GPU-picked face
under its start point as the rotation target; the renderer's camera-navigation pick-point seam
reads the winning fragment's NDC depth and unprojects the exact displayed world
position. This follows GPU deformation and non-planar tessellation instead of
reconstructing an undeformed CPU face plane.
The picked orbit point is a fixed world-space pivot for the gesture. Orbit
rotates the existing camera frame around it without first translating the eye
or `camera.target`, so the first movement is proportional to the pointer delta
instead of recentering sharply. If pointer movement begins before the GPU pick
resolves, the gesture uses the current model-bounds center and ignores the late
result. Wheel, Shift+middle-drag, and pinch change only eye distance or
orthographic scale around the current stable target. Zoom therefore never
scales or re-picks the target away from the model, and equal unclamped
zoom-out/zoom-in sequences are reversible.

The scene bound is a conservative orbit collision volume, while zoom protects
each transformed placed-part bound independently. Every control-driven orbit
and zoom applies the full requested angular or scale change, then moves the eye
outward along its new view direction only when a protected bound would
otherwise reach or cross the camera plane. This keeps rotation available at
close range without reviving a CPU mesh-raycast path.
Externally supplied viewport cameras receive the same full-scene protection,
so fitting one selected occurrence cannot place the eye inside another or clip
the rest of the model.
Orthographic scale stops at 5% of the scene scale. Every transition recomputes a
finite clip interval from the live positive scene depths; the near plane is no
farther than one quarter of the nearest protected depth or one thousandth of
the target distance, whichever is smaller.
The WebGPU renderer projects its active pivot to a
high-contrast three-axis screen-space widget at that world-space position. The X/Y/Z
directions follow the current camera projection, while the widget dimensions scale
with device pixels and stay stable through perspective, orthographic, and resize changes.
The widget is visible only while the orbit gesture is active. Spin is
continuous through the poles: orbit rotates the eye, target, and orthonormal
view-frame up direction as one rigid basis, so the view never needs a pole
clamp or a singular-frame fallback. Both spin and pan use the SpaceClaim
direction convention. One-finger touch resolves the same picked model target.
Left-drag is reserved for selection, including its
shift-based inspection modifiers. The demo presentation uses a light studio
background and restrained material colors so geometry edges and selection
emphasis remain legible. Its lower-left viewport-owned view cube follows the
camera's screen-space world-axis projection: six named faces and eight signed
corners snap the camera, while four pitch/yaw arrows and two curved roll arrows
rotate by 15° (90° with Shift, 5° with Ctrl/Meta). Roll is defined by the
visible result: clockwise moves a point above the target to the right, and
counterclockwise moves it to the left, without changing the line of sight,
target, framing, or clip planes. Face and corner snaps restore their canonical
up direction. Pressing `Z` fits the selected visible occurrences (or the
complete scene when there is no selection) through an interruptible one-second
eased transition. Its final framing targets the selection while its eye
position and clip interval continue to protect the complete displayed scene.

Camera admission through `createCamera` and `FemViewport.setCamera` rejects
non-finite vectors/scalars, degenerate view bases, invalid field of view or
clip ranges, and incomplete viewport dimensions. Camera transitions reject
non-finite deltas and pivots; finite zero/negative resize values normalize to
one pixel at the resize boundary. The internal validation is centralized in
the camera subsystem and is not a public assertion API.

[rendering/element-rendering|Element rendering]: element-rendering.md
[rendering/interactive-state|Interactive state]: interactive-state.md
