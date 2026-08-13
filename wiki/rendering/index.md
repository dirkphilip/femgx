# Rendering and interaction

- [[rendering/box-selection-gesture|Box-selection gesture]] — the primary
  mouse/pen box-drag lifecycle and its screen-space rectangle preview.
- [[rendering/camera-depth-convention|Camera depth convention]] — WebGPU
  depth-range and projection conventions.
- [[rendering/camera-presentation|Camera presentation]] — orthographic-default framing,
  projection transitions, and CAD-style navigation.
- [[rendering/camera-touch-controls|Camera touch controls]] — pointer-driven
  one-finger orbit, pinch zoom, two-finger pan, and gesture cancellation.
- [[rendering/element-interaction|Element-level interaction]] — element
  picking, selection, highlighting, and edge overlays.
- [[rendering/heterogeneous-elements|Heterogeneous element parts]] — one mixed
  element model compiled into deterministic triangle, line, and point parts.
- [[rendering/fe-inspection-workbench|FE inspection workbench]] — the demo's
  model presets, GPU picking, shared workbench controller, and e2e
  coverage.
- [[rendering/element-rendering|Element rendering]] — core linear and quadratic
  tessellation.
- [[rendering/face-subsets|Face subsets]] — validated exterior or explicit
  element-face selection through compact GPU index orders.
- [[rendering/interactive-state|Interactive state]] — centralized highlight,
  selection, hover, and style precedence.
- [[rendering/interaction-selection-menu|Selection and view context menu]] —
  plain replacement, modifier selection, empty-space clearing, and view
  actions.
- [[rendering/node-face-interaction|Node and face interaction]] — node/face
  picking, selection, and the four-attachment GPU pick pass.
- [[rendering/order-independent-transparency|Order-independent transparency]]
  — weighted-blended OIT, effective-alpha classification, and the deterministic
  shell/interior fixture.
- [[rendering/pick-format|Pick texture format]] — portable packed GPU pick IDs.
- [[rendering/platform-support|Platform support]] — WebGPU as the product
  requirement, explicit unsupported behavior, and supported-path device
  recovery.
- [[rendering/renderer-subrange-updates|Renderer subrange updates]] — delta
  updates for instance and element GPU state.
- [[rendering/selection-occlusion|Selection through occlusion]] — renderer-owned
  visible and weighted-ghost selection presentation.
- [[rendering/shader-variants|Explicit shader variants]] — typed construction
  of triangle, line, and node-pick WGSL sources from shared fragments.
- [[rendering/webgpu-e2e|WebGPU browser e2e lane]] — real-WebGPU browser
  coverage on the default e2e lane.
- [[rendering/webgpu-resource-reuse|WebGPU resource reuse]] — cached frame,
  depth, bind-group, and readback resources.
- [[rendering/wgsl-reserved-keywords|WGSL reserved keywords vs wgsl_reflect]] —
  shader identifiers that only Tint rejects, and how to validate them.
- [[rendering/coordinate-spaces|Coordinate spaces]] — browser input, render
  pixels, WebGPU NDC depth, and displayed world positions.

[rendering/camera-depth-convention|Camera depth convention]: camera-depth-convention.md
[rendering/camera-presentation|Camera presentation]: camera-presentation.md
[rendering/camera-touch-controls|Camera touch controls]: camera-touch-controls.md
[rendering/box-selection-gesture|Box-selection gesture]: box-selection-gesture.md
[rendering/coordinate-spaces|Coordinate spaces]: coordinate-spaces.md
[rendering/element-interaction|Element-level interaction]: element-interaction.md
[rendering/element-rendering|Element rendering]: element-rendering.md
[rendering/face-subsets|Face subsets]: face-subsets.md
[rendering/fe-inspection-workbench|FE inspection workbench]: fe-inspection-workbench.md
[rendering/heterogeneous-elements|Heterogeneous element parts]: heterogeneous-elements.md
[rendering/interaction-selection-menu|Selection and view context menu]: interaction-selection-menu.md
[rendering/interactive-state|Interactive state]: interactive-state.md
[rendering/node-face-interaction|Node and face interaction]: node-face-interaction.md
[rendering/order-independent-transparency|Order-independent transparency]: order-independent-transparency.md
[rendering/pick-format|Pick texture format]: pick-format.md
[rendering/platform-support|Platform support]: platform-support.md
[rendering/renderer-subrange-updates|Renderer subrange updates]: renderer-subrange-updates.md
[rendering/selection-occlusion|Selection through occlusion]: selection-occlusion.md
[rendering/shader-variants|Explicit shader variants]: shader-variants.md
[rendering/webgpu-e2e|WebGPU browser e2e lane]: webgpu-e2e.md
[rendering/webgpu-resource-reuse|WebGPU resource reuse]: webgpu-resource-reuse.md
[rendering/wgsl-reserved-keywords|WGSL reserved keywords vs wgsl_reflect]: wgsl-reserved-keywords.md
