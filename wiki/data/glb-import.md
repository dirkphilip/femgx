# GLB display-scene import

GLB is a deliberately narrow CAD display path from [[requirements/product-scope|the product
scope]]. `importGlb(source)` accepts self-contained GLB 2.0 bytes and returns the existing
`Scene`, deterministic part names/styles, and typed diagnostics; it never creates `FemModel`,
FE elements, nodes, bodies, results, or a parallel runtime graph.

## Mapping

- The declared default glTF scene is selected; when absent, the first scene is selected with an
  informational diagnostic.
- A synthetic root assembly contains one named assembly per reachable glTF node. Node matrix/TRS
  transforms are preserved as column-major femgx matrices, and node order is deterministic.
- Supported indexed or non-indexed `TRIANGLES` primitives with a FLOAT `POSITION` VEC3 are grouped
  by material within each reusable glTF mesh. Each material group becomes one reusable `Part`, so
  primitive-heavy display meshes retain their authored style boundaries without creating one scene
  part and GPU batch per tiny primitive. Shared accessors are validated and retained once per import.
  Unsigned byte, short, and int indices are promoted to `Uint32Array` when necessary.
- Repeated glTF mesh references reuse those Parts through multiple assembly placements. No FE
  topology or pick ids are synthesized.
- `baseColorFactor` maps to the existing `StyleOverride.color`. OPAQUE ignores source alpha,
  BLEND preserves it, and MASK uses a documented primitive-wide cutoff approximation. Textures,
  UVs, normals, PBR extras, animation, lights, and double-sided material state are ignored with
  bounded diagnostics.
- glTF coordinates are preserved numerically under glTF's meter convention; femgx performs no
  unit conversion.

## Extension boundary

The checked-in `onshape-cylinder-uncompressed.glb` and `onshape-cylinder-compressed.glb` fixtures
were supplied from Onshape and identify `ONSHAPE BY PTC INC, 1.219`. The compressed export requires
`KHR_draco_mesh_compression`, which is decoded before the scene is mapped. The optional
`PTC_onshape_metadata` extension is intentionally ignored with one warning. Required unsupported
extensions are fatal; optional ignored extensions are warnings, and `strict: true` promotes warnings
to rejection.

## Diagnostics

Fatal container, parser, transform, position, index, unsupported-required-extension, and
no-supported-geometry failures reject with `IoError`. Recoverable ignored extensions, textures,
unsupported optional primitives, and the MASK approximation return stable `Issue` records in
non-strict mode.

[requirements/product-scope|product scope]: ../requirements/product-scope.md
