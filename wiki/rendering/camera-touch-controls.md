# Camera touch controls

Camera navigation is public library behavior driven by unified pointer tracking
in `src/camera/controls.ts`, so any femgx canvas gets the same functional
SpaceClaim-style mouse and touch controls without adopting the demo's tree,
toolbars, or inspection panels.

## Gestures

- **Middle drag** spins (`orbitCamera`); **Ctrl/Meta+middle drag** pans
  (`panCamera`) in the drag direction at the target plane's current
  CSS-pixel scale; **Shift+middle drag** zooms vertically around the current
  camera target.
- **Wheel** and **Shift+middle drag** change eye distance or orthographic scale
  around the current fixed camera target; an upward wheel/drag motion zooms in
  and a downward motion zooms out.
- **Left mouse drag** is not a camera gesture, preserving click and
  shift-click inspection selection.
- **One finger** remains tap-safe through 10 CSS pixels of incidental movement,
  then resolves the visible model point under the initial touch and orbits it.
- **Spin** rotates the complete view frame, including its orthonormal `up`
  direction, so it has no pole clamp and can turn through repeated full circles.
- **Two fingers** pinch-zoom and pan together around the current panned target:
  the pinch distance change maps
  to a log-scale zoom (`zoom = ln(distance / previousDistance)`, so spreading
  zooms in) and the midpoint movement maps to a two-finger pan.
- **One-finger tap** still performs pick/selection; a camera drag is never
  treated as a click (the controller discards clicks whose distance from the
  pointer-down position exceeds 10 CSS pixels).

## Gesture state machine

`src/camera/gestures.ts` contains the pure, DOM-free `CameraGestureTracker` that
turns pointer events into `GestureStep` deltas. It is unit-tested in
`test/demo/camera-gestures.test.ts`:

- One pointer reports its pixel drag delta.
- Two pointers report the midpoint movement plus the pinch zoom; the baseline
  is taken when the second pointer lands, so the first move is not a jump.
  The current midpoint is included in each two-pointer step in canvas CSS
  coordinates.
- Three or more pointers freeze the gesture; when a pointer lifts back to one
  or two, the baseline is recomputed from the current positions.
- `end` is idempotent, so it can be driven by `pointerup`, `pointercancel`,
  `lostpointercapture`, and an uncaptured `pointerout` alike.

## Cancellation safety

A gesture is cleared (and the controller's `dragging` flag reset) by any of:

- `pointerup`,
- `pointercancel`,
- `lostpointercapture` (fires after cancel or when the browser reclaims
  capture, e.g. window blur),
- `pointerout` **only when the pointer is not captured** — during a captured
  drag the pointer can leave the canvas while moves keep arriving, so an
  uncaptured `pointerout` is the safety net when capture never took.

The controller reflects the live gesture state in `data-dragging` on the canvas
and the camera pose in `data-camera`. Focused camera tests own gesture state
invariants and interruption handling; `e2e/demo/mobile.spec.ts` and
`e2e/demo/demo-lifecycle.spec.ts` retain the responsive and view-cube routes
that are meaningful at the workbench boundary.

## Design notes and limitations

- `touch-action: none` remains scoped to the canvas elements only, so the rest
  of the page keeps native scrolling.
- A host-routed touch may prevent the pointer-down before camera controls see
  it. The workbench uses this bounded arbitration for its mobile Box select
  tool; Navigate remains the default.
- Middle-button and one-finger orbit use the camera-navigation pick-point and
  cancellation contract described in [[rendering/camera-presentation|Camera
  presentation]]. Wheel and Shift+middle zoom do not issue a pick or change
  the target.
- Pinch applies midpoint pan first, using the current target-plane CSS scale,
  and changes zoom without moving that panned target. Every orbit and zoom
  protects each placed-part bound, moves the eye outward instead of blocking a
  rotation, and recomputes clip planes from current scene depths.

## Related demo fixes

- The demo initializes and refits the camera from the canvas CSS rectangle,
  matching the CSS-local coordinates accepted by renderer picking. The WebGPU
  drawing buffer can therefore scale independently for device pixel ratio
  without moving the picked rotation point away from the cursor.
- `visibilityToggle` now takes an explicit part/assembly kind instead of
  inferring it from `scene.parts.has(id)`: gallery part 1 collides with the
  root assembly id 1, which previously mislabeled the assembly checkbox as
  `part-vis-1`.

Related: [[rendering/camera-presentation|Camera presentation]],
[[rendering/fe-inspection-workbench|FE inspection workbench]].

[rendering/camera-presentation|Camera presentation]: camera-presentation.md
[rendering/fe-inspection-workbench|FE inspection workbench]: fe-inspection-workbench.md
