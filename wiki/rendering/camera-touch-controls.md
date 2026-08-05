# Camera touch controls

The demo's camera navigation is driven by unified pointer tracking in
`demo/camera-controls.ts`, so desktop mice and phone touch share one code path.

## Gestures

- **One finger / left drag** orbits (`orbitCamera`).
- **Shift-drag or middle-button drag** pans (`panCamera`).
- **Wheel** zooms toward the target (`zoomCamera`).
- **Two fingers** pinch-zoom and pan together: the pinch distance change maps
  to a log-scale zoom (`zoom = ln(distance / previousDistance)`, so spreading
  zooms in) and the midpoint movement maps to a two-finger pan.
- **One-finger tap** still performs pick/selection; a camera drag is never
  treated as a click (the controller discards clicks whose distance from the
  pointer-down position exceeds 5px).

## Gesture state machine

`demo/camera-gestures.ts` exposes a pure, DOM-free `CameraGestureTracker` that
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
and the camera pose in `data-camera`; `e2e/mobile.spec.ts` uses these to assert
one-finger orbit, pinch zoom, two-finger pan, tap selection, and — crucially —
that an interrupted touch (`touchCancel`) never leaves dragging stuck. The e2e
lane injects raw multi-touch via CDP (`Input.dispatchTouchEvent`) because
Playwright's `touchscreen` API is single-touch only.

## Design notes and limitations

- `touch-action: none` remains scoped to the canvas elements only, so the rest
  of the page keeps native scrolling.
- Pinch zoom currently uses the existing `zoomCamera` (target-anchored). The
  midpoint is used for the two-finger pan, which keeps the pinch feeling
  anchored; an exact screen-point-anchored zoom would need an
  unprojection/`zoomCameraAt`-style camera API and is out of scope for the demo.

## Related demo fixes

- `WorkbenchController.resolve` scales CSS viewport coordinates into camera
  pixel space (`camera.width`/`camera.height`) before picking. The projection
  (and therefore `projectPoint` and `rayFromCamera`) works in the canvas
  internal pixel space, so picking was misaligned whenever CSS scaled the
  canvas — worst on phone-sized viewports, where most of the model was not
  tappable. The scale is identity when `camera.width` already tracks the CSS
  size (after a window resize), so it is correct in both modes.
- `visibilityToggle` now takes an explicit part/assembly kind instead of
  inferring it from `scene.parts.has(id)`: gallery part 1 collides with the
  root assembly id 1, which previously mislabeled the assembly checkbox as
  `part-vis-1`.

Related: [[rendering/camera-presentation|Camera presentation]],
[[rendering/fe-inspection-workbench|FE inspection workbench]].
