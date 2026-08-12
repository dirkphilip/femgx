# Performance issues and risks

This note records the remaining scalability risks after the first WebGPU renderer.

## Stable instance identity

The [[architecture/packed-runtime|packed scene runtime]] assigns a stable numeric
slot over the whole placement list and keeps the path-derived `instanceId` for
host-facing identity. Hiding or showing an earlier placement can change its
compact draw-list position, so GPU picking and incremental updates resolve
through the packed slot mapping.

## Scene update cost

_Resolved for visibility by the [[architecture/packed-runtime|packed scene runtime]]_: the
runtime flips packed visibility bits in place and reports deltas, so hide/show
cost is proportional to the changed placements instead of the whole model.

`SceneBuilder` copies maps and visibility sets for each builder operation. This
is convenient for small scenes, but repeated additions or visibility changes
copy O(n) state and can become quadratic while authoring large in-memory
assemblies. The packed runtime and its delta-oriented update path keep the
current product path practical.

## Packed compile cost

The packed scene runtime uses one explicit iterative walk for every assembly
expansion, preserving placement order and stable paths without recursion. It
keeps authoring storage in typed arrays and updates visibility in place; transform
edits recompose world transforms only within the affected subtree (see
[[architecture/packed-runtime|Packed scene runtime]]), keeping frame work
proportional to changed state.

## Matrix layout correctness

Resolved: `Mat4` multiplication and point transforms use column-major indexing,
with rotation/scale coverage in `test/mat4.test.ts`.

## Renderer and validation gaps

The renderer is split into focused modules under `src/renderer/` (see
[[architecture/source-organization|Source organization]]): `gpu-pipelines.ts` owns pipeline and
resource creation, `gpu-draw.ts` owns per-part geometry/instance buffers and draw
submission, `gpu-pick.ts` owns the pick targets and readback,
`runtime-state.ts` bridges the [[architecture/packed-runtime|packed runtime]] slots to
part-local storage, and `attachment.ts` owns the renderer's CPU-side scene
attachment (layout, calls, pick snapshot, and incremental deltas). `gpu-renderer.ts`
is a thin orchestrator.

_Resolved_: packed visibility/transform/style deltas are now wired into GPU
subrange writes (`WebGpuRenderer.updateInstances` patches slot-stable record
buffers and compacts per-part draw-order buffers; see
[[rendering/renderer-subrange-updates|Renderer subrange updates]]). GPU instance buffers,
picking, and resource lifecycle are mocked in CPU-only unit tests. The default
WebGPU-capable browser lane now exercises the real renderer through the demo
(see [[rendering/webgpu-e2e|WebGPU browser e2e lane]]); true WebGPU frame-time
benchmarking is covered by the opt-in real-Chrome capacity suite. It separates
unique and submitted geometry plus visible, pick-snapshot, and readback costs
without adding cross-device timing thresholds. The CPU side of performance is
covered by [[engineering/benchmarks|deterministic benchmarks and budgets]].

### Headless WebGPU pitfalls

Running the WebGPU lane headlessly surfaced three real renderer bugs that the
mocked device could not catch:

- `GPUQueue.writeBuffer` rejects byte offsets and lengths that are not multiples
  of 4. `patchInstances`' diffed subrange writes were expanded to 4-byte
  alignment in `gpu-draw.ts`.
- Integral user-defined vertex outputs and fragment inputs (the pick `u32`)
  require the `@interpolate(flat)` attribute in WGSL.
- On some headless SwiftShader builds the canvas swapchain texture is invalid
  unless `--enable-gpu` is passed (see [[rendering/webgpu-e2e|WebGPU browser e2e lane]]);
  the e2e lane passes both `--enable-unsafe-webgpu` and `--enable-gpu`.

The demo requires WebGPU and reports an explicit unsupported state when it
cannot initialize, instead of failing silently; the e2e lane launches Chromium
with `--enable-unsafe-webgpu --enable-gpu` (software WebGPU) so the default CI
gate exercises the real renderer. A broken WebGPU environment must get a typed
unsupported result instead of a second renderer (see
[[rendering/platform-support|Platform support]]).

### SwiftShader r32uint picking reliability

_Resolved_: pick ids are now packed across the four RGBA channels of an
`rgba8unorm` texture instead of `r32uint` (see [[rendering/pick-format|Pick texture
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
[[rendering/webgpu-resource-reuse|WebGPU resource reuse]]). Per-part instance buffers only
grow; a grown-out buffer is replaced without being destroyed immediately, so it
is only released when the renderer is destroyed — deferred buffer destruction
for growth is still future work. Pick targets are reused across frames and
resized on demand; their geometry snapshot is rendered lazily on the first pick
after pick-relevant state changes rather than during every visible frame. That
snapshot now rasterizes geometry once: a one-invocation compute pass reads the
winning depth texel from the ID pass depth attachment, replacing the former
second geometry traversal and `r32float` color target.

## Toolchain reproducibility

The repository pins Node 24.18.0 in `.nvmrc` as the exact convenient local
selection. `package.json.devEngines.runtime` is the npm-owned development
boundary: npm 11 rejects repository install and run commands on a Node runtime
older than 24. `engines.node` remains the published package's consumer
compatibility declaration. Node 21 is unsupported by the current toolchain.

## Large-model streaming

**Removed** — the former `src/streaming/` subsystem (chunk parse, spatial
partition, budgeted upload, coordinate rebasing) was deleted to match
[[requirements/product-scope|product scope]]. Do not re-add it without an
explicit product decision. In-memory models remain the product path.

## Quadratic element tessellation trade-offs

**Core trade-off** — quadratic shapes are part of the minimum product (see
[[requirements/product-scope|product scope]]).

Quadratic (Line3/Tri6/Quad8/Tet10/Hex20) geometry is tessellated through mid-edge nodes
rather than reduced to linear facets (see
[[rendering/element-rendering|Element rendering]]). The cost is a constant CPU/upload
factor, never a runtime draw cost:

- Tri6 and Tet10 faces use 4 triangles; Quad8 and Hex20 faces use 6. Compared
  with their linear counterparts, quadratic models upload 2-4x the triangle
  geometry per element family.
- Quadratic shapes use a fixed linearization through authored mid-edge nodes,
  so their upload cost is predictable and the mid-edge node is always honored.
- These are one-time costs at part build time, amortized across instances by
  instancing; the draw remains a single instanced call per part.
- Boundary-face culling runs before tessellation, so culled interior faces never
  reach the vertex buffers; edge overlay topology is derived from the retained
  triangle part when requested.

Risk: a large quadratic model multiplies the vertex footprint even though the
draw count is unchanged. Exact curved interpolation is intentionally outside
the product contract and would require a fresh product decision.

[architecture/packed-runtime|packed runtime]: ../architecture/packed-runtime.md
[architecture/packed-runtime|packed scene runtime]: ../architecture/packed-runtime.md
[architecture/source-organization|Source organization]: ../architecture/source-organization.md
[engineering/benchmarks|deterministic benchmarks and budgets]: benchmarks.md
[rendering/element-rendering|Element rendering]: ../rendering/element-rendering.md
[rendering/platform-support|Platform support]: ../rendering/platform-support.md
[rendering/renderer-subrange-updates|Renderer subrange updates]: ../rendering/renderer-subrange-updates.md
[rendering/webgpu-e2e|WebGPU browser e2e lane]: ../rendering/webgpu-e2e.md
[rendering/webgpu-resource-reuse|WebGPU resource reuse]: ../rendering/webgpu-resource-reuse.md
[requirements/product-scope|product scope]: ../requirements/product-scope.md
