# Rendering and interaction

- [[rendering/camera-depth-convention|Camera depth convention]] — WebGPU
  depth-range and projection conventions.
- [[rendering/camera-presentation|Camera presentation]] — perspective framing,
  projection transitions, and CAD-style navigation.
- [[rendering/camera-touch-controls|Camera touch controls]] — pointer-driven
  one-finger orbit, pinch zoom, two-finger pan, and gesture cancellation.
- [[rendering/element-interaction|Element-level interaction]] — element
  picking, selection, highlighting, and edge overlays.
- [[rendering/fe-inspection-workbench|FE inspection workbench]] — the demo's
  model presets, GPU picking, shared workbench controller, and e2e
  coverage.
- [[rendering/element-rendering|Element rendering]] — linear core tessellation
  and retained deferred quadratic coverage.
- [[rendering/interactive-state|Interactive state]] — centralized highlight,
  selection, hover, and style precedence.
- [[rendering/node-face-interaction|Node and face interaction]] — node/face
  picking, selection, and the four-attachment GPU pick pass.
- [[rendering/pick-format|Pick texture format]] — portable packed GPU pick IDs.
- [[rendering/platform-support|Platform support]] — WebGPU as the product
  requirement, explicit unsupported behavior, and supported-path device
  recovery.
- [[rendering/renderer-subrange-updates|Renderer subrange updates]] — delta
  updates for instance and element GPU state.
- [[rendering/webgpu-e2e|WebGPU browser e2e lane]] — real-WebGPU browser
  coverage on the default e2e lane.
- [[rendering/webgpu-resource-reuse|WebGPU resource reuse]] — cached frame,
  depth, bind-group, and readback resources.
- [[rendering/wgsl-reserved-keywords|WGSL reserved keywords vs wgsl_reflect]] —
  shader identifiers that only Tint rejects, and how to validate them.
- [[rendering/coordinate-spaces|Coordinate spaces]] — browser input, render
  pixels, WebGPU NDC depth, and displayed world positions.
