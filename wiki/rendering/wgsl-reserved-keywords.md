# WGSL reserved keywords vs wgsl_reflect

Chrome's Tint validator rejects some source that the `wgsl_reflect` parser
accepts. Identifiers in the WGSL reserved-keyword list (for example `match`)
compile under `wgsl_reflect` but make `createShaderModule` fail with a hidden
error that only surfaces later as:

```
[Invalid ShaderModule] is invalid due to a previous error.
While validating vertex stage ([Invalid ShaderModule], entryPoint: "vertexMain").
While calling [Device].CreateRenderPipeline([RenderPipelineDescriptor]).
```

## Gotcha

- The unit tests in `test/renderer/gpu-shaders.test.ts` only parse the shaders
  with `wgsl_reflect`, which does **not** enforce reserved keywords, so a
  regression like `var match = ...` in `src/renderer/gpu-shaders.ts` passes
  lint, typecheck, and unit tests.
- Reflection also does not establish every address-space-specific layout rule.
  In particular, a fixed-size scalar array such as `array<u32, 3>` has a
  4-byte element stride and is illegal in a `var<uniform>` structure, even
  when the calculated offsets appear to fit. Use explicit scalar padding
  members when preserving a compact uniform record such as the 16-byte
  deformation uniform.
- The real WebGPU path (demo and the Playwright lane that launches Chromium
  with `--enable-unsafe-webgpu`) is the only place the failure shows up.
- Reflection tests protect CPU/GPU offsets and record sizes, but do not prove
  browser-valid WGSL. Check every new identifier and address-space layout
  before editing shaders. Any WGSL change must validate every shader module
  with `getCompilationInfo()` against a real device (for example via the
  Playwright WebGPU lane or a one-off browser probe).

Renderer startup now awaits `getCompilationInfo()` for every shader module and
validates each render/compute pipeline inside a validation error scope before
publishing a renderer. Diagnostics retain the logical module or pipeline label
and source location; warnings are observable without preventing startup, while
errors produce a labeled initialization failure. The demo-only
`?testShaderFailure=<label>` seam exercises this contract in browser smoke tests
without adding a public API.

Related: [[rendering/webgpu-e2e|WebGPU browser e2e lane]].

[rendering/webgpu-e2e|WebGPU browser e2e lane]: webgpu-e2e.md
