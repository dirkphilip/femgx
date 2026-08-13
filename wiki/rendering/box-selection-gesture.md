# Box-selection gesture

The library exposes a renderer-independent box-drag lifecycle in
`src/interaction/box-selection.ts` (`installBoxSelection`), and the demo draws
the gesture as one lightweight screen-space rectangle overlay.

## Library contract

`installBoxSelection({ canvas, onEvent })` returns a disposer. It owns the
complete primary-pointer gesture state machine and never touches the model,
`InteractionState`, picking, or the renderer.

- **Arming.** Only a primary-button (`button === 0`) mouse or pen
  `pointerdown` arms the gesture. Touch and non-primary or concurrent pointers
  are ignored. The pointer is captured and a clamped anchor is recorded; no
  event is emitted yet, so an ordinary click stays an ordinary click.
- **Activation.** The gesture activates only after moving more than the shared
  10 CSS-pixel threshold, then emits exactly one `start` with the clamped
  current point and the normalized rectangle. The same shared threshold keeps
  the demo's click-versus-drag rule intact (see `WorkbenchInteraction.click`).
- **Updates.** Every later move from the tracked pointer emits one `change`.
  Modifier booleans (`shift`/`control`/`alt`/`meta`) reflect the current
  pointer event, so a host can observe modifier changes mid-gesture. Browser
  drag/text-selection default behavior is prevented once active.
- **Completion.** `pointerup` after activation emits one `complete` with the
  final clamped rectangle. State is cleared before capture is released, so the
  resulting `lostpointercapture` can never emit a second terminal event.
  `pointerup` while merely armed emits nothing.
- **Cancellation.** An active `pointercancel`, unexpected `lostpointercapture`,
  Escape, or the disposer emits one `cancel` with a typed reason
  (`pointer-cancel` / `lost-pointer-capture` / `escape` / `dispose`). Cancelling
  while armed emits no event. Escape is inert when no gesture exists; repeated
  terminal inputs and repeated disposal are safe no-ops.

## Coordinates and the rectangle

All emitted coordinates are finite canvas-local CSS pixels measured from the
canvas content-box origin, converted through the shared `clientToCanvasCss`
helper and clamped to the canvas CSS bounds on every side. `getBoundingClientRect()`
is re-read per pointer event so resize or layout changes do not leave stale
offsets. Every rectangle is normalized (`left <= right`, `top <= bottom`) with
`width = right - left` and `height = bottom - top`, independent of drag
direction. Nothing is converted to backing-store/device pixels here.

The interaction subsystem depends on camera-owned view-basis helpers and
math-owned vector operations; the subsystem DAG allows interaction → camera
and interaction → math so this code reuses those owners instead of duplicating
the operations.

## Demo ownership

`demo/workbench/box-preview.ts` (`WorkbenchBoxPreview`) renders lifecycle events
onto the `#box-selection-overlay` element in `index.html`: absolute-positioned,
`pointer-events: none`, a blue 1px border and subtle translucent fill, z-indexed
above the canvas but below the menus/axis gizmo, hidden by default. `start` and
`change` position/show it directly from `event.rect`; `complete`, `cancel`, and
teardown hide it and clear its inline geometry.

`WorkbenchController` installs `installBoxSelection` before the workbench hover
listeners so the threshold-crossing move marks box interaction active before
hover handling runs. Demo-only box activity is tracked separately from camera
gesture activity; `isPointerGestureActive()` combines the two, and the hover
listener suppresses asynchronous GPU picks while either is active. On
completion, `WorkbenchInteraction` sends one request containing the completed
event and captured Element/Face/Node granularity to its workbench-private box
selection resolver. The default visible-surface resolver makes one
`pickRegion(event.rect, granularity)` call; a workbench-owned resolver may
replace candidate discovery without taking over selection mutation. Plain completion
replaces selection with distinct returned targets; Ctrl/Meta toggles them, while
Shift and Alt remain reserved without select-through behavior. The pending query
is generation-checked, so newer clicks, context actions, model changes, resets,
teardown, resolver changes, and rejected promises cannot mutate selection;
cancellation and below-threshold gestures never query.

## Connection to region picking

The gesture remains policy-free. The demo's default resolver passes the completed
rectangle and captured granularity to `viewport.pickRegion` and applies the
returned nearest-visible targets to `InteractionState`; the library gesture
itself never mutates selection. Other hosts can use the same region API with
their own selection policy.

## World-space consumer volume

`boxSelectionFrustum(camera, event.rect)` converts the same normalized rectangle
into six named, normalized world-space planes. The planes face inward and use
the signed-distance rule `dot(plane.normal, point) + plane.distance >= 0` for
inside or on-plane points. Perspective side planes meet at the camera position;
orthographic side planes remain parallel. Reversed rectangles are normalized,
partially out-of-range rectangles are clamped to the camera viewport, and
non-finite or zero-area inputs throw. This host-owned volume query complements
`FemViewport.pickRegion`: it does not restore renderer frustum culling or mutate
selection.

Related: [[rendering/interaction-selection-menu|Selection and view context
menu]], [[rendering/interactive-state|Interactive state]],
[[rendering/coordinate-spaces|Coordinate spaces]].

[rendering/coordinate-spaces|Coordinate spaces]: coordinate-spaces.md
[rendering/interaction-selection-menu|Selection and view context menu]: interaction-selection-menu.md
[rendering/interactive-state|Interactive state]: interactive-state.md
