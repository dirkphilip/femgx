# Explicit shader variants

Renderer WGSL variants are assembled from typed TypeScript inputs and shared
WGSL fragments. Triangle and line stages receive their logical
vertices-per-primitive explicitly; node-pick stages also declare whether their
third corner is the authored second or third corner. No production shader
variant is produced by replacing text in a completed WGSL source string.

Visible and node-pick point sprites share the `spriteCorner` fragment so their
screen-space corner ordering cannot drift. Every assembled variant remains
behind the existing shader-module and pipeline validation boundary before it
is used by a WebGPU pipeline.

This keeps primitive indexing, corner loading, deformation node lookup, and
pick-id association reviewable at the TypeScript construction site without
introducing a shader AST, material system, or runtime compilation mode.
