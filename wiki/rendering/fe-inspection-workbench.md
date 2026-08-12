# FE inspection workbench

The demo is an FE model inspection workbench: deterministic model presets,
GPU picking via `FemViewport.pick` (node → face → element), a shared
workbench controller, and per-node/face/element selection and highlighting that
never rebuilds geometry or clones materials. The WebGPU renderer drives the
controller, so camera and interaction behavior is stable
([[rendering/element-interaction|Element-level interaction]],
[[rendering/interactive-state|Interactive state]]).

## Model presets

- `demo/fixture/presets.ts` builds six deterministic product stories from fixed data:
  the **bolted plate assembly**, imported **VTK sample**, **supported element gallery**,
  linearly tessellated **Hex20 cylinder**, **static results** workflow, and
  **order-independent transparency** demonstration. Every preset is derived from fixed
  data, so the demo and tests share identical structure.
- Each preset carries `elementModels` (per-part element topology used for
  node/face picking and emphasis), a part theme, and overall bounds. All scene
  parts start visible; the demo's model `<select>` switches presets without
  editing source.
- `demo/fixture/performance-fixture.ts` owns a demo-only stress scenario rather than
  extending the library: one generated 128 × 128 shell is instanced 64 times
  for exactly 2,097,152 triangles. The opt-in benchmark lane consumes it directly;
  it is not an ordinary product story or live-demo measurement loop.

## GPU picking

- Interaction picking is asynchronous GPU readback: `RendererHooks.pick` →
  `FemViewport.pick(x, y)` returning a complete host-mappable `PickHit`; hosts
  use `interactionTargetFromHit` to choose part / instance / body / element /
  face / node selection policy.
- Default granularity prefers the **most specific available target**
  (`node` > `face` > `element` > `instance`). Modifier keys promote/narrow the
  selection: shift → element, alt → instance, ctrl → part (see
  `demo/workbench/pick.ts`).
- A node or face context menu keeps its exact owning element and exposes
  **Select element** / **Deselect element** alongside an unambiguous target
  action. Selecting an unselected element replaces the ordinary selection;
  deselecting it removes only that element. Instance, part, and empty-scene
  targets never fabricate an element action.
- A completed primary-button box drag calls `FemViewport.pickRegion` once at
  element granularity. Plain drags replace selection with the returned visible
  elements; Ctrl/Meta drags toggle them. Shift and Alt do not add select-through
  behavior, and stale or rejected region readbacks cannot overwrite newer
  interaction state.
- The workbench ignores stale readbacks with a pick generation counter so
  hover/click races never apply an older hit.
- Hit data is stable across visibility changes because ids come from the
  packed runtime and part geometry descriptors, not from draw-list order.

## Workbench controller

- `demo/workbench/controller.ts` (`WorkbenchController`) owns active-preset and
  DOM presentation policy while `FemViewport` owns the packed runtime, camera,
  controls, interaction synchronization, visibility, picking, and renderer
  lifecycle. Focused `demo/workbench/` modules own async picking, selection
  state, visibility actions/tree construction, menu rendering, presentation,
  and abortable DOM bindings; `demo/devtools/diagnostics.ts` owns diagnostics
  formatting and `demo/workbench/lifecycle.ts` owns listener lifetime. The
  controller remains the only stateful orchestration surface and is kept below
  the 400-line implementation ceiling.
- The **visibility panel is a hierarchical tree** built from the authoritative
  scene graph: expandable assembly rows (with a disclosure button and an
  explicit `Assembly`/`Part` identity-kind badge) nest the parts placed beneath
  them. A row's checkbox reflects its subtree's effective assembly visibility
  as checked, unchecked, or mixed, and clicking a mixed parent restores the
  whole subtree. Toggling an assembly applies the authoring visibility to every
  descendant assembly through the runtime's delta-oriented visibility API, so
  no geometry is rebuilt and no material is cloned. Part and assembly controls
  keep separate namespaces (`data-part-id` vs `data-assembly-id`) and never
  infer identity from a shared numeric id. Pure tree helpers live in
  `demo/workbench/visibility-tree.ts` and are unit-tested
  (`test/demo/visibility-tree.test.ts`).
- Node/face/element selection is stored in `InteractionState`. Node and face
  emphasis are rendered through the library emphasis APIs
  (`emphasizedNodeRefs`/`emphasizedFaceRefs` and `resolveNodeStyle`/
  `resolveFaceStyle`) rather than derived into `elementOverrides`; the
  demo-side `emphasis.ts` fold was removed. `elementOverrides` now holds only
  explicit element highlights set through `setElementOverride`
  ([[architecture/demo-library-boundary|Demo / library boundary]]).
- Display toggles (edges, nodes, diagnostics) update workbench presentation and
  interaction state only; they never rebuild reusable geometry or drop selection
  state. Diagnostics are an opt-in, bounded HUD with `hidden` as its authoritative
  visibility state, and the same action is available from target and empty-scene
  context menus. The `nodes` toggle
  bulk-applies the part-level node membership flag to eligible non-Point parts;
  Point parts keep their primary glyphs without a duplicate annotation pass. The
  `edges` overlay is a real WebGPU pass with depth testing kept as an implementation
  invariant rather than exposed as a persistent user control. Coplanar overlay
  edges are offset in clip space in their vertex shader, rather than using a
  second surface or a backend-dependent pipeline depth bias. Shell triangles
  are two-sided by default, so a genuine 2D FE surface remains visible from
  either side. Every ordinary product story starts with edges and finite-element
  node annotations enabled; startup, preset switches, and Reset use the same
  inspection-first defaults and reapply per-part edge overrides after replacing
  the scene
  ([[rendering/webgpu-e2e|WebGPU browser e2e lane]]).
- Body rows expose independent visibility checkboxes and body-name highlight
  buttons; the name button is outside the checkbox label so visibility and
  highlighting cannot interfere. Part rows with multiple placements expose a collapsed `Instance` list. Each
  instance checkbox updates that one runtime slot, preserving the ability to
  hide or restore individual placements without expanding the assembly model.
  The context-menu **Show all** action restores assembly definitions and
  occurrences, parts, placements, and every body occurrence in one batched
  visibility update. It preserves selection, highlights, hover state, explicit
  styles, results, and camera state.
- The full-screen layout keeps the hierarchical visibility tree in a 340–380px
  left rail; the WebGPU canvas owns the remaining space. The toolbar is one calm
  surface with model, **Fit model**, projection, edges, nodes, results, and
  **Reset all** controls. Fit model changes only camera framing; Reset all
  restores the active preset's complete deterministic workbench state. Both
  actions expose help text describing that scope.
  Healthy renderer/status telemetry and inspection details stay hidden until
  explicitly needed; renderer failures remain prominent. Diagnostics stay within
  the scene, scroll internally when needed, and remain visible in the compact
  mobile scene. On mobile the scene is first and the hierarchy follows it, while
  the toolbar uses exactly two rows.
- The controller exposes a `rendererState` note (e.g. `recovered`) for status
  presentation. `FemViewport` performs recovery and reports success/failure to
  the demo callbacks ([[rendering/platform-support|Platform support]]).
- The toolbar **Reset all** action restores the active preset's complete initial
  state: all runtime hierarchy/part/instance visibility, palette
  interaction state, orthographic camera fitted to the scene, edge/node toggles,
  diagnostics, selection/hover/pick datasets, and the inspection
  panel. It does not switch the selected model preset.

## Mobile / responsive layout

The demo layout is responsive at phone widths (`index.html`): the scene keeps
the top portion of the viewport while the visibility rail moves below it;
secondary toolbar controls and the inspection overlay are hidden, and the
remaining primary controls get 44px touch targets. The right-click context
menu clamps its position inside the viewport (see
`WorkbenchMenu` in `demo/workbench/menu.ts`) so it never
opens past the right or bottom edge.

## Orientation gizmo and viewport boundary

The interactive view cube is owned by `FemViewport`, not by the demo. Hosts opt
in during `createFemViewport` with `orientationGizmo: { container }`, where the
container contains the canvas. The viewport creates one SVG root with six face,
eight corner, four pitch/yaw arrow controls, and two curved in-plane roll
controls; it updates their projections from the exact camera during the normal
render lifecycle and removes them during `destroy()`. Face/corner snaps and
arrow steps return immutable cameras through the viewport owner, while recovery
and scene changes reuse the same DOM. The demo passes its `.scene` wrapper and
owns only the surrounding toolbar/status presentation.

The demo's `.scene` wrapper also owns the restrained perimeter outline. It uses
an outline rather than a canvas border so CSS content dimensions and pointer,
resize, and GPU-picking coordinates remain unchanged.

## Ownership boundaries

The demo root contains only the browser entry, deterministic fixtures, and
explicit ownership directories:

- `demo/workbench/` owns user-facing inspection behavior and DOM lifecycle;
- `demo/devtools/` owns diagnostics text and the typed browser-test harness;
- `demo/benchmark/` owns the opt-in WebGPU benchmark and its internal imports.

The workbench controller is intentionally still cohesive because it is the one
stateful coordinator for preset, interaction, display, and viewport transitions.
Feature construction, listener lifetime, DOM formatting, and benchmark execution
are separate owners, so controller changes do not also change the developer
harness or benchmark contract.

## Demo e2e coverage

`e2e/demo.spec.ts` covers preset switching, initial visibility, the hierarchical
assembly tree (collapse/expand, plate-stack/fastener/fastener-subassembly hides,
mixed parent state, and restoring a subtree from its parent), fit-to-view,
projection, the context menu, node/face picking and selection, and stable
rendering after repeated orbit interactions.
`e2e/mobile.spec.ts` asserts at a 390x844 viewport that the page has no
horizontal overflow, primary controls stay reachable with 44px hit areas, and
the context menu fits inside the viewport. The default Playwright lane runs the
real WebGPU renderer through the same controller
([[rendering/webgpu-e2e|WebGPU browser e2e lane]]).

[architecture/demo-library-boundary|Demo / library boundary]: ../architecture/demo-library-boundary.md
[rendering/element-interaction|Element-level interaction]: element-interaction.md
[rendering/interactive-state|Interactive state]: interactive-state.md
[rendering/platform-support|Platform support]: platform-support.md
[rendering/webgpu-e2e|WebGPU browser e2e lane]: webgpu-e2e.md
