# FE inspection workbench

The demo is an FE model inspection workbench: deterministic model presets,
GPU picking via `WebGpuRenderer.pick` (node → face → element), a shared
workbench controller, and per-node/face/element selection and highlighting that
never rebuilds geometry or clones materials. The WebGPU renderer drives the
controller, so camera and interaction behavior is stable
([[rendering/element-interaction|Element-level interaction]],
[[rendering/interactive-state|Interactive state]]).

## Model presets

- `demo/fixture/presets.ts` builds deterministic models from fixed data: the
  **bolted plate assembly**, the imported **VTK sample block**, the complete
  **element gallery**, and a curved **Hex20 cylinder**. Every preset is derived
  from fixed data, so the demo and tests share identical structure.
- Each preset carries `elementModels` (per-part element topology used for
  node/face picking and emphasis), a part theme, per-mode part visibility, and
  overall bounds. The demo's model `<select>` switches presets without editing
  source.
- `demo/fixture/performance-fixture.ts` owns a demo-only stress scenario rather than
  extending the library: one generated 128 × 128 shell is instanced 64 times
  for exactly 2,097,152 triangles. The live scene overlay reports total
  triangles, sampled frame rate, and draw batches from the normal WebGPU path.

## GPU picking

- Interaction picking is asynchronous GPU readback: `RendererHooks.pick` →
  `WebGpuRenderer.pick(x, y)` → `resolvePickTarget`, returning a host-mappable
  `PickTarget` (part / instance / element / face / node).
- Default granularity prefers the **most specific available target**
  (`node` > `face` > `element` > `instance`). Modifier keys promote/narrow the
  selection: shift → element, alt → instance, ctrl → part (see `demo/pick.ts`).
- The workbench ignores stale readbacks with a pick generation counter so
  hover/click races never apply an older hit.
- Hit data is stable across visibility changes because ids come from the
  packed runtime and part geometry descriptors, not from draw-list order.

## Workbench controller

- `demo/controller.ts` (`WorkbenchController`) owns active-preset and DOM
  presentation policy while `FemViewport` owns the packed runtime, camera,
  controls, interaction synchronization, visibility, picking, and renderer
  lifecycle. The controller wires the control
  bar, visibility panel, inspection panel, stats panel, and the right-click
  context menu.
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
  `demo/visibility-tree.ts` and are unit-tested
  (`test/demo/visibility-tree.test.ts`).
- Node/face/element selection is stored in `InteractionState`. Node and face
  emphasis are rendered through the library emphasis APIs
  (`emphasizedNodeRefs`/`emphasizedFaceRefs` and `resolveNodeStyle`/
  `resolveFaceStyle`) rather than derived into `elementOverrides`; the
  demo-side `emphasis.ts` fold was removed. `elementOverrides` now holds only
  explicit element highlights set through `setElementOverride`
  ([[architecture/demo-library-boundary|Demo / library boundary]]).
- Display toggles (edges, diagnostics) flip renderer state only; they never
  rebuild reusable geometry or drop selection state. The `edges` overlay is a
  real WebGPU pass with a depth-test control that stays live. Coplanar overlay
  edges are offset in clip space in their vertex shader, rather than using a
  second surface or a backend-dependent pipeline depth bias. Shell triangles
  are two-sided by default, so a genuine 2D FE surface remains visible from
  either side
  ([[rendering/webgpu-e2e|WebGPU browser e2e lane]]).
- Part rows with multiple placements expose a collapsed `Instance` list. Each
  instance checkbox updates that one runtime slot, preserving the ability to
  hide or restore individual placements without expanding the assembly model.
- The full-screen layout keeps the hierarchical visibility tree in a left rail;
  the WebGPU canvas owns the remaining space. Inspection and telemetry are
  compact scene overlays, so there is no separate CPU-canvas results renderer.
  The control bar shows the active renderer in a `#renderer-status` chip next
  to the model selector.
- The controller exposes a `rendererState` note (e.g. `recovered`) for status
  presentation. `FemViewport` performs recovery and reports success/failure to
  the demo callbacks ([[rendering/platform-support|Platform support]]).

## Mobile / responsive layout

The demo layout is responsive at phone widths (`index.html`): the scene keeps
the top portion of the viewport while the visibility rail moves below it;
secondary toolbar controls and the inspection overlay are hidden, and the
remaining primary controls get 44px touch targets. The right-click context
menu clamps its position inside the viewport (see
`WorkbenchController.clampMenuToViewport` in `demo/controller.ts`) so it never
opens past the right or bottom edge.

## Demo e2e coverage

`e2e/demo.spec.ts` covers preset switching, mode visibility, the hierarchical
assembly tree (collapse/expand, plate-stack/fastener/fastener-subassembly hides,
mixed parent state, and restoring a subtree from its parent), fit-to-view,
projection, the context menu, node/face picking and selection, and stable
rendering after repeated orbit interactions.
`e2e/mobile.spec.ts` asserts at a 390x844 viewport that the page has no
horizontal overflow, primary controls stay reachable with 44px hit areas, and
the context menu fits inside the viewport. The default Playwright lane runs the
real WebGPU renderer through the same controller
([[rendering/webgpu-e2e|WebGPU browser e2e lane]]).
