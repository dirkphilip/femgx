# WebGPU resource reuse and synchronization

This note documents which GPU resources are cached across frames and the
synchronization constraints the renderer relies on. See
[[architecture/architecture-overview|Architecture overview]] and
[[architecture/instancing-strategy|Instancing strategy]] for the surrounding design.

## What is cached

Per-frame allocations were removed from `src/renderer/`:

- **Instance bind groups** — `drawBatches` stores one `GPUBindGroup` per
  `BatchResource` (`src/renderer/gpu-draw.ts`) and reuses it for every frame and
  every pass (color + pick) that draws the same per-part instance buffer. A new
  bind group is created only when the instance buffer grows (a new
  `BatchResource` replaces the old one), never per frame. Bind groups are not
  GPU-owned destroyable resources, so replacing an entry is safe.
- **Color + depth targets** — `ensureColorTargets` keeps a multisampled
  (`COLOR_SAMPLE_COUNT` = 4) color texture and matching depth-stencil on
  `DrawResources`, and only recreates them when the canvas pixel size changes.
  Each visible frame resolves the MSAA color into the canvas swap chain.
  `resize` keeps the targets; the next render lazily replaces them if the size
  changed. Pick targets stay single-sampled.
- **Pick readback** — `readPickPixel` borrows a `GPUBuffer` from
  `PickReadbackPool` (`src/renderer/gpu-pick.ts`) instead of allocating and
  destroying one per pick. Buffers reserve five 256-byte lanes: four satisfy
  the texture-copy `bytesPerRow` alignment and the fifth receives the scalar
  depth extracted by compute. They are reused across picks and resizes.
  `pickRegion` borrows the same pool with capacity-aware buffers, copies only
  the requested ID attachments, and tiles large rectangles under a bounded
  byte budget; region reads never copy depth.
  `resize` resets only the render targets (`resetPickTargets`) and keeps the
  size-independent readback pool and depth-extraction pipeline; `destroy`
  releases every pooled and intermediate buffer.
- **Pick snapshot** — visible rendering does not encode pick geometry. The first
  `pick()` after camera, canvas, geometry/placement,
  visibility, or deformation changes renders one current ID/depth snapshot;
  later readbacks reuse it. Interaction colors, edge/node overlays, and the
  rotation-origin widget does not invalidate the snapshot because it does not change hit
  geometry.

## Synchronization constraints

WebGPU map operations are async and non-overlapping, which the readback pool is
designed around:

- A buffer must not be mapped twice, and `mapAsync` + `unmap` on the same buffer
  must not interleave. The pool hands a buffer out only after the previous pick
  finished with it: buffers are `inFlight` while their `mapAsync` is pending and
  only move to `free` after `unmap` in `readPickPixel`'s `finally`. Two
  concurrent picks therefore get distinct buffers (the pool grows by one rather
  than blocking or double-mapping).
- A pooled buffer is only re-queued for new ID copies and depth extraction after
  its previous map resolved, i.e. after the GPU work it was read from has completed.
  That makes reuse safe: no two submitted commands reference the same buffer at
  the same time.
- `mapAsync` resolves only after the copy is complete, so a successful read is a
  happens-after barrier for the queue; no extra fence is needed.
- On failure (including `mapAsync` rejection), the buffer is still unmapped if
  needed and returned to the pool, so it is never leaked or handed out while
  mapped.
- `destroyPickTargets` (renderer teardown only) destroys pooled readback
  buffers. This must not race an in-flight pick: `renderer.destroy()` should be
  called only when no `pick()` promise is pending. `resize` calls
  `resetPickTargets` instead, which keeps the pool intact, so a pick in flight
  during a resize completes normally and its buffer is reused. See
  [[engineering/performance-issues|Performance issues and risks]] for the remaining risks.

## Still not cached

- Part geometry buffers and per-part instance buffers are created once and only
  grow; a grown-out instance buffer is replaced but not immediately destroyed
  (deferred destruction is future work, see the file-improvement notes in the
  #29 implementation).
- The camera uniform buffer and its bind group are created once per renderer.

[architecture/architecture-overview|Architecture overview]: ../architecture/architecture-overview.md
[architecture/instancing-strategy|Instancing strategy]: ../architecture/instancing-strategy.md
[engineering/performance-issues|Performance issues and risks]: ../engineering/performance-issues.md
