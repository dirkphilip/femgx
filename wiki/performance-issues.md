# Performance issues and risks

This note records the remaining scalability risks after the first WebGPU renderer.

## Stable instance identity

`flattenAssembly` assigns a compact visible `index` after visibility culling.
Hiding or showing an earlier placement can change that draw index, so GPU picking
and incremental per-instance updates use the separate path-derived `instanceId`.
The [[packed-runtime|packed scene runtime]] adds a third, fully packed handle: a
stable numeric instance slot over the whole placement list that never changes
across visibility updates.

## Scene update cost

_Resolved for visibility by the [[packed-runtime|packed scene runtime]]_: the
runtime flips packed visibility bits in place and reports deltas, so hide/show
cost is proportional to the changed placements instead of the whole model.

`SceneBuilder` copies maps and visibility sets for each builder operation. This
is convenient for small scenes, but repeated additions or visibility changes
copy O(n) state and can become quadratic while authoring large models. A packed
runtime representation, batch construction, and a delta-oriented update path are
needed for very large assemblies.

## Flattening cost

`flattenAssembly` allocates a matrix for every visited placement and creates a new
instance object for every visible placement. It now uses an iterative walk,
deterministic per-part batching, and optional frustum culling. The packed scene
runtime keeps authoring storage in typed arrays and updates visibility in place;
transform edits now recompose world transforms only within the affected subtree
(see [[packed-runtime|Packed scene runtime]]), keeping frame work proportional to
changed state.

## Matrix layout correctness

Resolved: `Mat4` multiplication and point transforms use column-major indexing,
with rotation/scale coverage in `test/mat4.test.ts`.

## Renderer and validation gaps

The renderer is split into focused modules under `src/renderer/` (see
[[source-organization|Source organization]]): `gpu-pipelines.ts` owns pipeline and
resource creation, `gpu-draw.ts` owns per-part geometry/instance buffers and draw
submission, `gpu-pick.ts` owns the pick targets and readback, and
`runtime-state.ts` bridges the [[packed-runtime|packed runtime]] slots to
part-local storage. `gpu-renderer.ts` is a thin orchestrator.

_Resolved_: packed visibility/transform/style deltas are now wired into GPU
subrange writes (`WebGpuRenderer.updateInstances` patches slot-stable record
buffers and compacts per-part draw-order buffers; see
[[renderer-subrange-updates|Renderer subrange updates]]). GPU instance buffers,
picking, and resource lifecycle are mocked in CPU-only unit tests. An opt-in
WebGPU-capable browser lane now exercises the real renderer through the demo
(see [[webgpu-e2e|WebGPU browser e2e lane]]); true WebGPU frame-time
benchmarking in a browser is still future work. The CPU side of performance is
covered by [[benchmarks|deterministic benchmarks and budgets]].

### Headless WebGPU pitfalls

Running the WebGPU lane headlessly surfaced three real renderer bugs that the
mocked device could not catch:

- `GPUQueue.writeBuffer` rejects byte offsets and lengths that are not multiples
  of 4. `patchInstances`' diffed subrange writes were expanded to 4-byte
  alignment in `gpu-draw.ts`.
- Integral user-defined vertex outputs and fragment inputs (the pick `u32`)
  require the `@interpolate(flat)` attribute in WGSL.
- On some headless SwiftShader builds the canvas swapchain texture is invalid
  unless `--enable-gpu` is passed (see [[webgpu-e2e|WebGPU browser e2e lane]]).

The demo probes presentation and picking before committing to WebGPU, so
broken environments degrade to the CPU renderer instead of failing.

### SwiftShader r32uint picking reliability

_Resolved_: pick ids are now packed across the four RGBA channels of an
`rgba8unorm` texture instead of `r32uint` (see [[pick-format|Pick texture
format]]), a byte-typed format that round-trips the full supported pick-id range
on every WebGPU implementation. Previously, in one headless SwiftShader
environment the `r32uint` pick readback returned corrupted values (float bit
patterns such as `0x3F800000`) for some instances even though the GPU
record/draw-order buffers were verified correct and a minimal r32uint pipeline
rendered cleanly — a software rasterizer quirk rather than a renderer bug. The
WebGPU lane stays capability-gated as a safety net: environments whose picking
is unreliable skip the picking test instead of failing.

### Remaining GPU allocation risks

_Resolved for frame resources_: `drawBatches` now reuses one bind group per
per-part batch resource across frames and passes, `render` keeps a single depth
texture that is only resized when the canvas size changes, and pick readback
reuses a pool of map buffers (see
[[webgpu-resource-reuse|WebGPU resource reuse]]). Per-part instance buffers only
grow; a grown-out buffer is replaced without being destroyed immediately, so it
is only released when the renderer is destroyed — deferred buffer destruction
for growth is still future work. The pick targets are already reused across
frames and resized on demand.

## Toolchain reproducibility

The repository pins Node 24.18.0 in `.nvmrc`, and the package engine declaration
uses a full semver lower bound so local tooling and Supervisor can select a
compatible Node runtime. Node 21 is unsupported by the current Vite/Rolldown
toolchain.
