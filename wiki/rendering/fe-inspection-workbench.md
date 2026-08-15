# FE inspection workbench

The demo is an FE model inspection workbench: deterministic model presets,
GPU picking via `FemViewport.pick` (node → face → element, with explicit authored-edge
granularity), a shared workbench controller, and per-node/face/element/edge selection and highlighting that
never rebuilds geometry or clones materials. The WebGPU renderer drives the
controller, so camera and interaction behavior is stable
([[rendering/element-interaction|Element-level interaction]],
[[rendering/interactive-state|Interactive state]]).

## Model presets

- `demo/fixture/presets.ts` builds seven deterministic product-story cases from fixed data:
  the **bolted plate assembly**, imported **VTK sample**, **element tessellation and mapping gallery**,
  linearly tessellated **Hex20 cylinder**, **section-plane volume**, **static results** workflow, and
  **order-independent transparency** demonstration. Every preset is derived from fixed data, so the demo
  and tests share identical structure.
- Each preset carries `elementModels` (per-part element topology used for
  node/face picking and emphasis), a part theme, and overall bounds. All scene
  parts start visible; the demo's model `<select>` switches presets without
  editing source.
- `demo/fixture/performance-fixture.ts` owns a demo-only stress scenario rather than
  extending the library: one generated 128 × 128 shell is instanced 64 times
  for exactly 2,097,152 submitted triangles. It remains available to diagnostics
  and the opt-in benchmark lane, but is not part of the ordinary model selector.
- The Performance Lab selector and benchmark cases are governed by
  [[requirements/demo-fixtures|the demo fixture requirements]]. Structured FE
  cases provide authored elements, shared node identities, stable primitive
  ownership, and separate logical-element, unique-triangle, and
  submitted-triangle counts. Every Performance Lab selector entry is
  inspectable at element granularity, and selecting one element never aliases
  the complete part through fixture aggregation. Large cases are lazy or
  opt-in; the migration of legacy aggregate cases is tracked in
  [issue #526](https://github.com/dirkphilip/femgx/issues/526).
  Performance Lab names and diagnostics identify the FE family, unique element
  count, submitted element occurrences, and unique/submitted triangle units.

## GPU picking

- Interaction picking is asynchronous GPU readback: `RendererHooks.pick` →
  `FemViewport.pick(x, y)` returning a complete host-mappable `PickHit`; hosts
  use `interactionTargetFromHit` to choose part / instance / body / element /
  face / node selection policy. The workbench's Edge mode requests
  `FemViewport.pick(x, y, "edge")` and retains occurrence-scoped authored keys.
- Default granularity prefers the **most specific available target**
  (`node` > `face` > `element` > `instance`). Modifier keys promote/narrow the
  selection: shift → element, alt → instance, ctrl → part (see
  `demo/workbench/pick.ts`).
- A node or face context menu keeps its exact owning element and exposes
  **Select element** / **Deselect element** alongside an unambiguous target
  action. Selecting an unselected element replaces the ordinary selection;
  deselecting it removes only that element. Instance, part, and empty-scene
  targets never fabricate an element action.
- Edge mode exposes shared and quadratic authored topology as `ed:<instance>:<key>`
  targets. Inspection reports canonical nodes, incident elements/faces, hit position,
  and tangent; it never invents one owning element for a shared edge. Through remains
  unavailable in Edge mode, while Visible region selection uses the same edge granularity.
- A completed primary-button box drag calls `FemViewport.pickRegion` once at
  element granularity. Plain drags replace selection with the returned visible
  elements; Ctrl/Meta drags toggle them. Shift and Alt do not add select-through
  behavior, and stale or rejected region readbacks cannot overwrite newer
  interaction state.
- The workbench ignores stale readbacks with a pick generation counter so
  hover/click races never apply an older hit.
- Hit data is stable across visibility changes because ids come from the
  packed runtime and part geometry descriptors, not from draw-list order.

## Section-plane inspection

- `FemViewport.setSectionPlane({ normal, distance })` keeps the world-space
  positive half-space `dot(normal, worldPosition) + distance >= 0`. The viewport
  validates and normalizes one finite non-zero normal; `clearSectionPlane()`
  restores the unclipped scene.
- The same frame uniform is consumed by opaque, weighted-transparent, edge,
  node-overlay, selection, and GPU-pick fragments. It uses deformed world
  positions and is retained across scene attachment, resize, and supported
  device recovery. The renderer-owned origin triad, orientation gizmo, and
  orbit pivot remain presentation cues outside the clipping contract.
- The demo's Off / Keep +X / Keep +Y / Keep +Z controls derive the offset range
  from complete placed-scene bounds and apply the state to both viewport panes.

## Workbench controller

- `demo/workbench/controller.ts` (`WorkbenchController`) owns active-preset and
  DOM presentation policy while `FemViewport` owns each packed runtime,
  camera, controls, interaction synchronization, visibility, picking, and
  renderer lifecycle. The controller keeps a small map of at most two
  demo-private viewport slots: the exact active `Scene` and workbench state are
  shared, while each slot owns its pane, camera, runtime, renderer, interaction
  readback generation, orientation gizmo, and render loop. Focused
  `demo/workbench/` modules own async picking, selection state, visibility
  actions/tree construction, menu rendering, presentation, and abortable DOM
  bindings; `demo/devtools/diagnostics.ts` owns diagnostics formatting and
  `demo/workbench/lifecycle.ts` owns listener lifetime.
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
- Display toggles (edges, nodes, diagnostics, and explicit Continuous rendering) update workbench presentation and
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
  When a reusable part declares authored semantic blocks, each occurrence also
  exposes its block rows beneath the owning body. Block rows carry the same
  occurrence-scoped visibility, hover, highlight, and context-selection
  semantics as the library interaction state; parts with direct body
  membership do not receive synthetic block rows. The context-menu **Show all**
  action restores block visibility along with every other visibility layer.
  The context-menu **Show all** action restores assembly definitions and
  occurrences, parts, placements, and every body occurrence in one batched
  visibility update. It preserves selection, highlights, hover state, explicit
  styles, results, and camera state.
- The full-screen layout keeps the hierarchical visibility tree in a 340–380px
  left rail; the viewport workspace owns the remaining space. It contains one
  primary pane by default and an optional secondary pane with equal desktop
  columns. Both panes use independent cameras and renderers while sharing the
  authoritative scene, selection, visibility, results, and model transitions.
  The canvas command bar is one calm, non-scrolling surface with four labeled
  disclosure targets: **Selection**, **View**, **Display**, and **Analysis**.
  Model selection and local-file loading live in the navigation rail, so the
  model source is not duplicated over either canvas. Selection owns granularity,
  Visible/Through box strategy, authored Edge selection, and selected-element
  visibility actions. View owns context-sensitive **Fit model**/**Fit selection**
  framing, projection, the labeled **Background** select (`Studio`, `White`, or
  `Dark`), and the optional secondary viewport. Display owns authored edges and
  nodes; Analysis owns one bounded contextual inspector with independent
  **Scalar**, **Deformation**, **Orientation**, and **Section** sections. Dependent
  controls disappear when their role cannot affect the current view, while the
  existing typed commands remain the only state boundary. When a result is active,
  a compact demo-owned legend renders structured field, location, unit, finite
  range, palette, deformation-scale, orientation, and section state;
  picked node/element/face inspection adds the exact authored scalar when its
  location permits an unambiguous value.
  The selector is demo-owned presentation state and calls the public viewport
  background setter; it survives model, local-file, reset, resize, recovery, and viewport
  replacement transitions, while a failed setter restores the last successful value
  through the existing model-feedback status region. The framing action labels
  itself **Fit selection** when visible geometry is selected and **Fit model**
  otherwise; both paths use the existing interruptible `fitSelection` contract and
  advertise the `Z` shortcut. Reset all restores the active preset's complete
  deterministic workbench state without changing the selected background. Both
  actions expose help text describing that scope.
  Reset, diagnostics, help, continuous rendering, and complete visibility
  restoration remain on their existing semantic surfaces: the context menu,
  status/diagnostics overlays, interaction help, or visibility rail. They are not
  persistent command-bar targets. Healthy renderer/status telemetry and inspection
  details stay hidden until explicitly needed; renderer failures remain prominent. Diagnostics stay within
  the scene, scroll internally when needed, and remain visible in the compact
  mobile scene. The command bar stays a single non-wrapping row, with disclosure panels sized
  for the available viewport. The bounded Analysis inspector scrolls only when
  the complete active role set cannot fit in the available phone height. The
  results panel also offers demo-private
  elemental vector selection, `Arrow`/`Axis` glyphs, `Direction`/`Normal`
  occurrence transforms, and a positive length scale; it states that vectors
  are normalized for orientation and that magnitude is not displayed. The
  results example covers signed normals, sign-invariant fibers, missing/zero
  rows, and a reflected non-uniform repeated placement.
- The controller exposes a `rendererState` note (e.g. `recovered`) for status
  presentation. `FemViewport` performs recovery and reports success/failure to
  the demo callbacks ([[rendering/platform-support|Platform support]]).
- The context-menu **Reset all** action restores the active preset's complete initial
  state: all runtime hierarchy/part/instance visibility, palette
  interaction state, orthographic camera fitted to the scene, edge/node toggles,
  diagnostics, selection/hover/pick datasets, and the inspection
  panel. It does not switch the selected model preset.

## Mobile / responsive layout

The demo layout has three shell regimes: a desktop navigation rail at widths
at least 1024px, a compact rail from 721px through 1023px, and one phone
navigation drawer at 720px and below. The phone drawer reuses the desktop
navigation DOM, traps focus while open, restores focus to its trigger on close,
and closes the contextual Analysis disclosure before showing its scrim. The
primary scene fills the visual viewport in the closed phone state, including
safe-area insets and visual-viewport height changes, so it exposes at least a
320x360 CSS-pixel canvas without nested page scroll. The command bar remains a
single non-wrapping row above the shared viewport container, including when two
viewports are open. A compact phone-only right tool rail provides 44px icon
targets for Navigate, Box select, and Select all; desktop keeps direct mouse/pen
box drag without the mode switch. The right-click
context menu measures and clamps itself inside the current viewport so it never
opens past the right or bottom edge.

## Orientation gizmo and viewport boundary

The interactive view cube is owned by `FemViewport`, not by the demo. Hosts opt
in during `createFemViewport` with `orientationGizmo: { container }`, where each
pane's container contains its canvas. Each viewport creates one SVG root with six face,
eight corner, four pitch/yaw arrow controls, and two curved in-plane roll
controls; it updates their projections from the exact camera during the normal
render lifecycle and removes them during `destroy()`. Face/corner snaps and
arrow steps return immutable cameras through the viewport owner, while recovery
and scene changes reuse the same DOM. The demo passes each pane wrapper and
owns only the surrounding toolbar/status presentation. The active pane receives
camera and keyboard commands; the other pane remains independently renderable.

Each demo scene-pane wrapper also owns the restrained perimeter outline. It uses
an outline rather than a canvas border so CSS content dimensions and pointer,
resize, and GPU-picking coordinates remain unchanged.

## Ownership boundaries

The demo root contains only the browser entry, deterministic fixtures, and
explicit ownership directories:

- `demo/workbench/` owns user-facing inspection behavior and DOM lifecycle;
- `demo/devtools/` owns diagnostics text and the typed browser-test harness;
- `demo/benchmark/` owns the opt-in WebGPU benchmark and its internal imports.

The workbench controller is intentionally still cohesive because it is the
stateful coordinator for preset, shared interaction, display, and up-to-two
viewport transitions. Each viewport slot remains demo-private; no public
viewport manager, shared runtime, or renderer pool is introduced. Feature
construction, listener lifetime, DOM formatting, and benchmark execution are
separate owners, so controller changes do not also change the developer harness
or benchmark contract.

## Demo e2e coverage

The current workbench journeys are split by ownership across
`e2e/demo/demo-lifecycle.spec.ts`, `e2e/demo/demo-visibility.spec.ts`, and
`e2e/demo/demo-interaction.spec.ts`.
`e2e/demo/mobile.spec.ts` asserts at a 390x844 viewport that the page has no
horizontal overflow, the phone drawer and Analysis disclosure are mutually
exclusive, primary controls stay reachable with 44px hit areas, the optional
viewport panes stack, and the context menu fits inside the viewport. The
focused layout gate also covers the 721px compact rail.
The default Playwright lane runs the real WebGPU renderer through the same controller
([[rendering/webgpu-e2e|WebGPU browser e2e lane]]).

`e2e/demo/demo-layout.spec.ts` is the focused layout gate. `npm run test:e2e:layout`
walks every ordinary story at 1440x900 and 390x844 and checks the 721x600
compact rail, asserting that hidden
result surfaces have no box or focus target, the toolbar stays inside its pane,
the canvas retains a useful exposed region, the legend and orientation gizmo
remain in scene bounds, and every story presents nonblank WebGPU pixels.

[architecture/demo-library-boundary|Demo / library boundary]: ../architecture/demo-library-boundary.md
[rendering/element-interaction|Element-level interaction]: element-interaction.md
[rendering/interactive-state|Interactive state]: interactive-state.md
[rendering/platform-support|Platform support]: platform-support.md
[rendering/webgpu-e2e|WebGPU browser e2e lane]: webgpu-e2e.md
