# WebGPU resource reuse and synchronization

This note documents which GPU resources are cached across frames and the
synchronization constraints the renderer relies on. See
[[architecture-overview|Architecture overview]] and
[[instancing-strategy|Instancing strategy]] for the surrounding design.

## What is cached

Per-frame allocations were removed from `src/renderer/`:

- **Instance bind groups** — `drawBatches` stores one `GPUBindGroup` per
  `BatchResource` (`src/renderer/gpu-draw.ts`) and reuses it for every frame and
  every pass (color + pick) that draws the same per-part instance buffer. A new
  bind group is created only when the instance buffer grows (a new
  `BatchResource` replaces the old one), never per frame. Bind groups are not
  GPU-owned destroyable resources, so replacing an entry is safe.
- **Depth texture** — `ensureDepthTexture` keeps a single depth attachment on
  `DrawResources` and only recreates it when the canvas pixel size changes;
  `render` no longer allocates and destroys one per frame. `resize` keeps the
  depth texture; the next render lazily replaces it if the size changed.
- **Pick readback** — `readPickPixel` borrows a `GPUBuffer` from
  `PickReadbackPool` (`src/renderer/gpu-pick.ts`) instead of allocating and
  destroying one per pick. Buffers are 256 bytes (the WebGPU minimum
  `bytesPerRow`) and are reused across picks and resizes. `destroy` releases
  every pooled buffer.

## Synchronization constraints

WebGPU map operations are async and non-overlapping, which the readback pool is
designed around:

- A buffer must not be mapped twice, and `mapAsync` + `unmap` on the same buffer
  must not interleave. The pool hands a buffer out only after the previous pick
  finished with it: buffers are `inFlight` while their `mapAsync` is pending and
  only move to `free` after `unmap` in `readPickPixel`'s `finally`. Two
  concurrent picks therefore get distinct buffers (the pool grows by one rather
  than blocking or double-mapping).
- A pooled buffer is only re-queued for a new `copyTextureToBuffer` after its
  previous map resolved, i.e. after the GPU work it was read from has completed.
  That makes reuse safe: no two submitted commands reference the same buffer at
  the same time.
- `mapAsync` resolves only after the copy is complete, so a successful read is a
  happens-after barrier for the queue; no extra fence is needed.
- On failure (including `mapAsync` rejection), the buffer is still unmapped if
  needed and returned to the pool, so it is never leaked or handed out while
  mapped.
- `destroyPickTargets` (used by `resize` and `destroy`) destroys pooled readback
  buffers. This must not race an in-flight pick: `renderer.destroy()` should be
  called only when no `pick()` promise is pending. See
  [[performance-issues|Performance issues and risks]] for the remaining risks.

## Still not cached

- Part geometry buffers and per-part instance buffers are created once and only
  grow; a grown-out instance buffer is replaced but not immediately destroyed
  (deferred destruction is future work, see the file-improvement notes in the
  #29 implementation).
- The camera uniform buffer and its bind group are created once per renderer.
