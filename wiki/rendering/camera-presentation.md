# Camera presentation

The demo starts in an orthographic isometric pose so the wide element gallery
reads as a dimensionally stable CAD view. Perspective remains an explicit
supported mode. Framing is calculated from all eight bounds corners and the
viewport aspect ratio. `fitCamera` preserves the current view direction/up
vector, retargets to the bounds center, and solves a 90% frame margin for
perspective distance or orthographic height. Hosts may provide a CSS-pixel
`fitContentInset` callback when overlays obscure part of the canvas; fitting
then uses and centers within the remaining rectangle. The same policy serves fit-to-view,
preset changes, reset, and fit-to-selection; no preset-specific distance is
needed.

Projection changes preserve vertical framing: converting from perspective derives
an orthographic height from camera distance, while converting back derives a
distance from that height. The demo refits after each explicit projection toggle,
so a previously complete model remains complete under the new projection and
overlay inset. See [[rendering/interactive-state|Interactive state]] for the related
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
instead of recentering sharply. While the asynchronous GPU pick is pending,
pointer movement advances the gesture baseline but does not change the camera or
publish a pivot marker. Once the pick resolves, subsequent movement uses the
picked point; a model-bounds center is used only for a definitive miss or
failure while the gesture remains active. A result after release, cancellation,
or replacement is ignored. Wheel, Shift+middle-drag, and pinch change only eye
distance or orthographic scale around the current stable target. Zoom therefore
never scales or re-picks the target away from the model, and equal unclamped
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
directions follow the current camera projection. Its fixed 28/3/8/6 CSS-pixel
axis, shaft, arrow-length, and arrow-width metrics scale by device pixel ratio and
stay stable through perspective, orthographic, and resize changes. The projected
pivot depth is preserved: opaque front fragments use an opaque `less-equal`
draw, while opaque-hidden fragments use the existing weighted-transparency targets
with fixed alpha `0.25` and `greater` depth. Transparent model fragments in front
can therefore blend over the visible marker. The widget is visible only while
the orbit gesture is active. Spin is
continuous through the poles: orbit rotates the eye, target, and orthonormal
view-frame up direction as one rigid basis, so the view never needs a pole
clamp or a singular-frame fallback. Both spin and pan use the SpaceClaim
direction convention. One-finger touch resolves the same picked model target.
Separately, every viewport renders one persistent positive X/Y/Z triad at world
origin `[0, 0, 0]`, enabled by default and suppressible with
`ViewportOptions.originTriad: false`. When enabled, its nominal world length
is 12% of the complete placed-scene bounds diagonal and is stable until scene
attachment or replacement; visibility, deformation, camera motion, projection,
resize, and device-pixel ratio do not change it. Each frame applies a
conservative 56 CSS-pixel cap to all projected positive-axis endpoints, so
zooming out lets the triad shrink with the model while close zoom remains
bounded. World-axis foreshortening remains visible. The visible portion is
opaque and depth-tested; the portion behind opaque model depth is a fixed-alpha
ghost accumulated through the normal weighted-transparency targets. This is a
presentation cue only: it contributes to neither scene bounds nor picking and
does not replace the lower-left orientation gizmo.
The viewport also supports one optional world-space section plane through
`ViewportPresentation.setSectionPlane({ normal, distance })`. Scene fragments keep the
positive half-space `dot(normal, worldPosition) + distance >= 0`; the validated
unit normal and signed distance are applied consistently to opaque, transparent,
edge, node-overlay, selection, and GPU-pick passes. The plane is presentation
state only: it does not change scene bounds, fit, identities, visibility, or
selection, and it never clips the origin triad, orientation gizmo, or orbit
pivot. `clearSectionPlane()` restores the complete scene, and recovery rewrites
the retained plane uniform on the rebuilt WebGPU resources.
Left-drag is reserved for selection, including its
shift-based inspection modifiers. The renderer owns the opaque viewport
background: `ViewportOptions.background` and `ViewportPresentation.setBackground()`
select the built-in `studio`, `white`, or `dark` WebGPU presentation without a
second pass or DOM fallback. Studio is the default restrained cool-neutral
top-to-bottom gradient with a visibly separated upper and lower field;
the presets do not affect depth, picking, interaction, or result rendering. The
demo uses the studio preset and restrained material colors so geometry edges and
selection emphasis remain legible. Its lower-left viewport-owned view cube follows the
camera's screen-space world-axis projection: six named faces and eight signed
corners snap the camera, while four pitch/yaw arrows and two curved roll arrows
rotate by 15° (90° with Shift, 5° with Ctrl/Meta). Each face visibly names its
world-coordinate plane (`XY`, `YZ`, or `XZ`) while retaining the signed side in
its accessible label and stable face attributes. The same retained SVG contains
a non-interactive projected positive X/Y/Z triad; its arms follow the current
camera basis, collapse deterministically when viewed end-on, and never change
navigation hit regions. Pitch and yaw arrow names describe the visible scene
rotation: up/down move projected content toward smaller/larger viewport Y,
while left/right retain their corresponding horizontal directions. Every face,
corner, and arrow action uses the same interruptible, eased approximately
400-millisecond camera transition as fit-to-selection. Roll is
defined by the visible result: clockwise moves a point above the target to the
right, and counterclockwise moves it to the left, without changing the line of
sight, target, framing, or clip planes. Face and corner snaps restore their canonical
up direction. Pressing `Z` frames the selected visible geometry (or the complete
scene when there is no selection) through an interruptible approximately
400-millisecond eased transition. Part selection includes every visible
occurrence; instance selection frames one occurrence; body, element, face, and
node selection frame the exact displayed geometry, including active deformation;
and multiple selections frame their visible union. Hidden or stale selections
with no displayed geometry leave the camera unchanged. Degenerate point, line,
and flat selections receive deterministic scene-scale padding. Its final framing
targets the selection while its eye position and clip interval continue to
protect the complete displayed scene.

`ViewportView.setCamera`, `fit`, and `fitSelection` accept an optional
`durationMs`. Omitted or zero duration applies immediately; `fitSelection`
defaults to approximately 400 milliseconds, while a positive finite value is
interruptible by direct camera manipulation, another camera command, scene
replacement, resize, or destruction. Hosts opt into the core `Z` shortcut by
passing `ViewportOptions.keyboardTarget`; no global listener is installed,
and repeat, modifiers, and editable targets are ignored. Reduced-motion
preferences make transitions immediate. A viewport created without an explicit
camera tracks an auto-fitted presentation: responsive `resize()` refits that
presentation using the current canvas size and `fitContentInset`, while direct
camera manipulation opts out until the host calls `fitView()` again. This keeps
user-authored zoom/orbit state intact during layout changes.

Camera admission through `createCamera` and `ViewportView.setCamera` rejects
non-finite vectors/scalars, degenerate view bases, invalid field of view or
clip ranges, and incomplete viewport dimensions. Camera transitions reject
non-finite deltas and pivots; finite zero/negative resize values normalize to
one pixel at the resize boundary. The internal validation is centralized in
the camera subsystem and is not a public assertion API.

[rendering/element-rendering|Element rendering]: element-rendering.md
[rendering/interactive-state|Interactive state]: interactive-state.md
