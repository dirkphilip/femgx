# Instancing strategy

Geometry that repeats (identical meshes, common element shapes) is uploaded once
as a [[architecture-overview|Part]] and drawn many times via GPU instancing.

## Model

- A part owns one set of vertex/index buffers and a bounding volume; it is
  immutable once uploaded.
- An assembly places parts (and sub-assemblies) with local transforms. Each
  placement of a part is an instance.
- `flattenAssembly` walks the tree depth-first and emits `Instance` records:
  `index`, `partId`, and a world transform. `index` is the GPU pick id.

## What the renderer must batch

- Group draw calls by part to minimize pipeline/bind-group changes.
- Per-instance data (world transform, color, pick id) lives in a single GPU
  buffer; the renderer patches only affected instance attributes on state
  changes (see [[interactive-state|Interactive state]]).
- Instance count is the performance lever: keep geometry upload amortized and
  per-frame work proportional to state changes, not instance rebuilds.

## Determinism

Depth-first, placement-order flattening keeps instance indices stable between
frames. This matters for picking consistency and for diffing state changes
against the authoritative scene.
