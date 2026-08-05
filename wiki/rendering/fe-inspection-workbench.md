# FE inspection workbench

The demo is an FE model inspection workbench: deterministic model presets,
unified CPU raycast picking (node → face → element), a shared
renderer-independent controller, and per-node/face/element selection and
highlighting that never rebuilds geometry or clones materials. WebGPU and CPU
fallback drive the same controller, so camera and interaction behavior is
identical ([[rendering/element-interaction|Element-level interaction]],
[[rendering/interactive-state|Interactive state]]).

## Model presets

- `src/fixture/presets.ts` builds three deterministic models from fixed
  options: the **element gallery** (tet/hex families plus point/line overlays),
  the **stiffened deck panel**, and the **portal frame** with conforming hex
  topology. Every preset is CPU-renderable and derived purely from fixed data,
  so the demo and tests share identical structure.
- Each preset carries `elementModels` (per-part element topology used for
  node/face picking and emphasis), a part theme, per-mode part visibility, and
  overall bounds. The demo's model `<select>` switches presets without editing
  source.

## Unified picking

- `src/picking/` provides CPU raycasting against the tessellated geometry the
  renderer draws, with per-part inspection caches built once per preset
  (triangle→element, node adjacency, face ownership).
- `pick()` resolves the **most specific available target**: a node near the
  pointer wins over the face the ray hits first, which wins over the element.
  Modifier keys promote/narrow the selection: shift → element, alt → instance,
  ctrl → part (see `demo/pick.ts`).
- Hit data is stable across visibility changes, draw-list compaction, and
  renderer switches because it is keyed by part/instance/element/node/face ids
  from the authoritative scene and element models.

## Workbench controller

- `demo/controller.ts` (`WorkbenchController`) owns the active preset, the
  packed runtime, interaction state, visibility, and display toggles, and
  drives whichever renderer is attached through `RendererHooks`. It wires the
  control bar, visibility panel, inspection panel, stats panel, and the
  right-click context menu.
- Node/face/element selection is stored in `InteractionState`; node/face
  emphasis is folded into per-element overrides by `demo/emphasis.ts` so both
  renderers can emphasize a node or face selection without new geometry.
- Display toggles (edges, node markers, normals, face boundaries, ids,
  diagnostics) flip renderer state only; they never rebuild reusable geometry
  or drop selection state.
- The controller exposes a `rendererState` note (e.g. `recovered`, `fallback`)
  that the status line shows after a GPU device loss; the WebGPU demo path
  recovers the renderer once and falls back to the CPU renderer when recovery
  is impossible ([[rendering/platform-support|Platform support]]).

## Demo e2e coverage

`e2e/demo.spec.ts` covers preset switching, mode visibility, part/assembly
visibility toggles, fit-to-view, projection, the context menu, node/face
picking and selection, and stable rendering after repeated orbit interactions.
The default Playwright lane runs the deterministic CPU renderer; the opt-in
WebGPU lane exercises the same controller against WebGPU
([[rendering/webgpu-e2e|WebGPU browser e2e lane]]).
