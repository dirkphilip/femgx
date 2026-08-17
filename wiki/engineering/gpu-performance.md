# GPU rendering performance

This note defines the durable measurement, mode, and memory contract for WebGPU
performance work. GitHub issues own executable work plans; this note owns the
rules that should survive those issues.

## Two timelines

CPU and GPU time are separate. Synchronous `renderer.render()` timing measures
JavaScript state synchronization and command encoding. `queue.submit()` is
asynchronous, while `queue.onSubmittedWorkDone()` is a coarse queue-drained wall
time that includes earlier queued work and perturbs pipelining. Neither is a
GPU-pass duration.

Actual pass duration uses `timestamp-query` when the adapter supports it. The
feature remains optional and diagnostic: ordinary devices must not require it,
ordinary frames must not allocate query/readback resources, and unsupported
adapters retain the structural and queue-drained benchmark evidence. Timestamp
results use delayed rotating readback buffers rather than a same-frame map.

Every measured renderer pass, pipeline, shader, bind group, buffer, texture,
query set, and command encoder has a stable label. Capturable frame structure
uses debug groups for opaque geometry, transparency, selection, presentation
edges, presentation nodes, helpers, and picking. Measurements report warmup,
median, p95, p99 where practical, resolution, DPR, adapter, browser, enabled
features, draw/index/instance counts, and retained/peak estimated bytes.

## Mode taxonomy

There is no single quality mode. Three independent axes describe supported
behavior:

| Axis                | States                                                       | Contract                                                                                          |
| ------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| Host data residency | Surface snapshot; host-updated surface; fully resident model | Determines which geometry and identities exist on the client. Omitted topology is never inferred. |
| Renderer admission  | Minimal presentation; topology presentation; feature path    | Derived internally from authoritative state. It is not a public quality choice.                   |
| Interaction storage | Empty; sparse; dense                                         | Chosen from active state density without changing interaction semantics.                          |

The minimal presentation path covers ordinary geometry and geometry/occurrence
style with no body/element visibility, fine emphasis, section clipping, result,
or exact fine-pick work. Topology presentation adds requested authored edges or
nodes without automatically admitting their exact interaction resources. The
feature path adds only the capabilities required by the affected occurrence
group. Pipeline admission changes when authoritative state changes, not by a
full-scene scan every frame.

Pipeline variants may use different shader modules and bind-group layouts. They
share canonical geometry and instance identity buffers; they must not duplicate
full geometry merely to remove unused bindings. Fixed empty sentinels are
acceptable where WebGPU layout validity requires them, but an omitted feature
must create no model-scaled buffer, ownership table, upload, shader read, draw,
or steady-frame work.

The current admission lattice has one reduced pipeline family and two semantic
families that retain the canonical feature layout:

- Minimal triangle color and transparency draws bind only the camera uniform,
  instance records, and draw order. Their shaders read geometry, occurrence
  transform/style, lighting, opacity, and the renderer-owned edge-depth marker;
  they do not declare topology, result, deformation, section, or emphasis
  bindings.
- Topology presentation covers authored lines/points and requested edge/node
  overlays while no feature state is active. It preserves the existing
  topology-aware shaders and does not materialize exact edge-pick resources
  until exact edge interaction is asked for; sectioning, results, deformation,
  or fine emphasis promote the affected batch to the feature path.
- The feature path admits results, deformation, section clipping, body/element
  visibility, fine emphasis, selection, and picking through the existing full
  pipeline family. A cached per-part admission is invalidated by the relevant
  authoritative state identity or highlight ownership change; steady frames do
  not rescan the scene or create pipelines.

A public interaction-detail or quality profile is not approved. If measured
internal fast paths cannot meet the dense-node budget without changing visible
semantics, that tradeoff requires a separate product decision with screenshots
and performance evidence. The renderer must not silently thin, omit, or resize
authored topology during navigation.

## Reference performance envelope

The system-Chrome `instanced-2.10m` case at 800×600 DPR 1 is the dense-overlay
reference, not a universal hardware guarantee. On the recorded Apple/Metal
adapter, surface and native-edge presentation reach approximately 120 FPS;
combined edges and nodes reach approximately 51–65 FPS, while synchronous CPU
encoding remains about 0.1 ms p50. Dense node coverage/overdraw is therefore the
next measured GPU target.

For this reference case, performance work targets:

- surface and edge-only moving-camera p50 at or below 8.33 ms and p95 at or
  below 12 ms;
- node-only and combined edge/node p50 at or below 11.1 ms, p95 at or below
  16.7 ms, and no repeated intervals above 33.3 ms;
- synchronous steady render/encoding p50 at or below 0.5 ms and p95 at or below
  1 ms;
- no model-scaled bytes or additional passes for inactive optional bodies,
  edges, nodes, fine picking, selection, results, or sectioning.

These are regression and prioritization thresholds for comparable runs. A
change is accepted from milliseconds and percentiles, not an FPS average alone.
Any apparent improvement must retain exact output/picking semantics for the
admitted capabilities and report memory as well as time.

## Diagnostic experiment order

Before changing a shader or data representation:

1. Reproduce the same case after warmup and capture CPU encoding, queue-drained
   time, RAF frame intervals, structural cost, and memory.
2. Isolate the pass with timestamps where supported or by disabling one logical
   workload at a time.
3. Scale one dimension: resolution/DPR, node or edge count, glyph diameter,
   triangle count, occurrence count, and active interaction density.
4. Replace the suspect vertex or fragment stage with a trivial diagnostic stage
   while preserving draw dimensions.
5. Change one implementation variable, rerun multiple samples, and compare
   median/p95 plus retained and peak bytes.

Large improvements from resolution or glyph diameter indicate fragment
coverage, overdraw, blending, or target bandwidth. Improvements from reduced
node/edge counts at constant resolution indicate vertex/primitive pressure.
Improvements from fewer draws at constant submitted geometry indicate CPU
encoding or state-change cost. Shader-source inspection without this evidence
does not establish the bottleneck.

## Memory and lifecycle rules

- Empty and inactive interaction use fixed shared resources, not capacity-sized
  per-element records.
- Per-part instance residency contains only the transform/style/identity record
  and ordinary visible order. Transparent, selection, node, edge, and emphasis
  storage is admitted independently, grows to its active order/table demand,
  and is released when that state returns to empty; the device retains only
  fixed valid empty bindings.
- Sparse state stores exceptions; dense state may use ordinal bitsets. Density
  transitions preserve state and are measured for allocation/upload peaks.
- Exact edge-pick geometry remains separate and lazy even when presentation
  edges are visible.
- Host-updated surface variants share immutable content where possible and use
  explicit byte budgets; a different surface is still a different logical part
  revision or variant.
- The Performance Lab retains empty catalog placeholders and at most one loaded
  capacity case. A deterministic CPU estimate combines the existing typed-array
  accounting with 208-byte planar or 3,072-byte structured-FE element-record
  allowances and uses a hard 256 MiB cap. Switching catalogs may keep an
  under-cap active case for fast return; selecting another case evicts it, and
  an over-cap case is rebuilt on explicit return. The demo never accumulates
  all capacity models or renderer resources.
- Device recovery recreates only resources required by current authoritative
  state and does not materialize inactive capabilities.

## Acceptance evidence

Rendering performance changes include focused unit/integration tests, the
opt-in real system-Chrome WebGPU case, desktop and 390×844 nonblank screenshot
inspection, and the normal repository gates. A benchmark-only mock or
no-WebGPU run cannot establish visual parity or GPU improvement.

[rendering/topology-residency|Topology ownership and residency]: ../rendering/topology-residency.md
