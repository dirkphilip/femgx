# WGSL reserved keywords vs wgsl_reflect

Chrome's Tint validator rejects some identifiers that the `wgsl_reflect`
parser accepts. Identifiers in the WGSL reserved-keyword list (for example
`match`) compile under `wgsl_reflect` but make `createShaderModule` fail with
a hidden error that only surfaces later as:

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
- The real WebGPU path (demo and the Playwright lane that launches Chromium
  with `--enable-unsafe-webgpu`) is the only place the failure shows up.
- Check every new WGSL identifier against the WGSL reserved-keyword list
  before editing shaders. When in doubt, validate the shader module with
  `getCompilationInfo()` against a real device (for example via the Playwright
  WebGPU lane or a one-off browser probe) rather than relying on the parser.

Related: [[rendering/webgpu-e2e|WebGPU browser e2e lane]].

[rendering/webgpu-e2e|WebGPU browser e2e lane]: webgpu-e2e.md
