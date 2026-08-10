# Camera touch controls

Camera navigation is public library behavior driven by unified pointer tracking
in `src/camera/controls.ts`, so any femgx canvas gets the same functional
SpaceClaim-style mouse and touch controls without adopting the demo's tree,
toolbars, or inspection panels.

## Gestures

- **Middle drag** spins (`orbitCamera`); **Shift+middle drag** pans
  (`panCamera`); **Ctrl+middle drag** zooms vertically (`zoomCamera`). This
  matches the default SpaceClaim desktop navigation.
- **Wheel** zooms toward the visible world point under the cursor
  (`zoomCameraAtPoint`); an upward wheel/drag motion zooms in and a downward
  motion zooms out. Empty space falls back to the target-anchored `zoomCamera`.
- **Left mouse drag** is not a camera gesture, preserving click and
  shift-click inspection selection.
- **One finger** continues to orbit on touch devices.
- **Spin** has no pole clamp, so it can turn through and beyond a full circle.
- **Two fingers** pinch-zoom and pan together: the pinch distance change maps
  to a log-scale zoom (`zoom = ln(distance / previousDistance)`, so spreading
  zooms in) and the midpoint movement maps to a two-finger pan.
- **One-finger tap** still performs pick/selection; a camera drag is never
  treated as a click (the controller discards clicks whose distance from the
  pointer-down position exceeds 5px).

## Gesture state machine

`src/camera/gestures.ts` contains the pure, DOM-free `CameraGestureTracker` that
turns pointer events into `GestureStep` deltas. It is unit-tested in
`test/demo/camera-gestures.test.ts`:

- One pointer reports its pixel drag delta.
- Two pointers report the midpoint movement plus the pinch zoom; the baseline
  is taken when the second pointer lands, so the first move is not a jump.
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
and the camera pose in `data-camera`; `e2e/mobile-touch.spec.ts` uses these to assert
one-finger orbit, pinch zoom, two-finger pan, tap selection, and — crucially —
that an interrupted touch (`touchCancel`) never leaves dragging stuck. The e2e
lane injects raw multi-touch via CDP (`Input.dispatchTouchEvent`) because
Playwright's `touchscreen` API is single-touch only.

## Design notes and limitations

- `touch-action: none` remains scoped to the canvas elements only, so the rest
  of the page keeps native scrolling.
- Middle-button orbit asks `WebGpuRenderer.pickPoint` for the exact visible
  surface point. Drag deltas wait for the asynchronous GPU readback, then apply
  once around that point, so the camera never starts around a stale target and
  switches pivots mid-gesture.
- Pinch zoom currently uses the existing `zoomCamera` (target-anchored). The
  midpoint is used for the two-finger pan, which keeps the pinch feeling
  anchored; cursor-anchored wheel zoom is implemented separately through the
  picked world point.

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
