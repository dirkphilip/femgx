# Performance issues and risks

This note records the main risks before the WebGPU renderer is implemented.

## Stable instance identity

`flattenAssembly` assigns `index` from the output array after visibility culling.
Hiding or showing an earlier placement therefore changes the IDs of later
instances. GPU picking and incremental per-instance updates need persistent
instance handles that are independent of the currently visible draw list.

## Scene update cost

`SceneBuilder` copies maps and visibility sets for each builder operation. This
is convenient for small scenes, but repeated additions or visibility changes
copy O(n) state and can become quadratic while authoring large models. A packed
runtime representation, batch construction, and a delta-oriented update path are
needed for very large assemblies.

## Flattening cost

Flattening recursively walks the entire hierarchy, allocates a matrix for every
placement, and creates a new instance object for every visible placement. It
does not yet cache transforms, propagate dirty subtrees, batch instances by
part, or perform bounds-based culling. These are renderer prerequisites for
keeping frame work proportional to changed state.

## Matrix layout correctness

`Mat4` is documented and populated as column-major, but `multiply` indexes its
inputs as row-major. Translation-only tests pass by coincidence; rotations,
scales, and general nested transforms can be incorrect.

## Renderer and validation gaps

The WebGPU renderer, GPU instance buffers, GPU picking, resource lifecycle, and
performance benchmarks are not implemented yet. Assembly construction also does
not validate missing references or cycles, and recursive traversal can overflow
on deeply nested input.

## Toolchain reproducibility

CI uses Node 24 while the current local environment is Node 21.7.1. Vitest and
the Vite/Rolldown toolchain currently fail during startup/build locally with a
Node `util.styleText` incompatibility. The supported Node version should be
declared and aligned across `package.json`, CI, and development documentation.
