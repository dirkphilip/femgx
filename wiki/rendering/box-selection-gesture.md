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

The interaction subsystem depends on the camera-owned coordinate helpers; the
subsystem DAG was widened (interaction → camera) so the helper reuses them
instead of duplicating the conversion.

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
listener suppresses asynchronous GPU picks while either is active. Completion
does not change selection, highlight, inspection, camera, visibility, results,
or the context-menu target.

## Connection to region picking

The gesture remains policy-free. A host that wants model candidates can pass an
event rectangle to `viewport.pickRegion(event.rect, granularity)`; the promise
returns unique nearest-visible targets and the host decides whether to preview,
select, toggle, or ignore them. The gesture itself never mutates selection.

Related: [[rendering/interaction-selection-menu|Selection and view context
menu]], [[rendering/interactive-state|Interactive state]],
[[rendering/coordinate-spaces|Coordinate spaces]].

[rendering/coordinate-spaces|Coordinate spaces]: coordinate-spaces.md
[rendering/interaction-selection-menu|Selection and view context menu]: interaction-selection-menu.md
[rendering/interactive-state|Interactive state]: interactive-state.md
