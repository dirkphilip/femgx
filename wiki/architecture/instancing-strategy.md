# Instancing strategy

Geometry that repeats (identical meshes, common element shapes) is uploaded once
as a [[architecture/architecture-overview|Part]] and drawn many times via GPU instancing.

## Model

- A part owns one set of vertex/index buffers and a bounding volume; it is
  immutable once uploaded.
- An assembly places parts (and sub-assemblies) with local transforms. Each
  placement of a part is an instance.
- One assembly definition may be placed repeatedly. Each placement contributes
  its own transform and stable expanded part-instance ids without cloning the
  assembly or its nested part definitions.
- `flattenAssembly` walks the tree depth-first and emits `Instance` records:
  `index`, stable `instanceId`, `partId`, and a world transform. `index` is the
  compact current draw/pick id; `instanceId` survives visibility changes.

## What the renderer must batch

- Group draw calls by part to minimize pipeline/bind-group changes.
- Per-instance data (world transform, color, pick id) lives in slot-stable
  storage GPU buffers; the renderer patches only changed contiguous byte
  subranges on state changes (see
  [[rendering/renderer-subrange-updates|Renderer subrange updates]]).
- Visibility is expressed as a compacted per-part draw-order buffer, so hidden
  geometry is never drawn and instance counts scale with the changed parts only.
- Instance count is the performance lever: keep geometry upload amortized and
  per-frame work proportional to state changes, not instance rebuilds.

## Determinism

Depth-first, placement-order flattening keeps source placement handles stable
between frames. Compact indices can change after culling; GPU picking is resolved
against the current compiled list and returns the stable handle.
